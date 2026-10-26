/**
 * dsh-whale-memory —— 会忘事的记忆。
 *
 * 只用 .mjs，不 import 任何 .ts（宿主 Node 不一定支持类型剥离）。
 * 对话捕获用 agent 作用域上的真实事件：
 *   agent/inbox/inserted  收到消息
 *   agent/turn-stopping   一轮结束（去历史里捞回复）
 * DSH 里**没有** user/message、assistant/message 这两个 Cordis 事件。
 */
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
import { recallContext } from "./recall.mjs";

export const name = "whale-memory";
export const inject = ["systemPrompt", "tools", "timer", "sessions", "llm", "agents"];

const HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
const DATA_DIR = join(HOME, "whale-memory");
const DB_PATH = join(DATA_DIR, "memory.db");

const today = () => new Date().toISOString().slice(0, 10);
const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 12)}`;

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, day TEXT, ts INTEGER, tier TEXT DEFAULT 'detailed',
      title TEXT, detail TEXT, affect_valence REAL DEFAULT 0, affect_arousal REAL DEFAULT 0,
      affect_summary TEXT, pinned INTEGER DEFAULT 0, key_facts TEXT DEFAULT '[]',
      strength REAL DEFAULT 1, size_tokens INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
      created_at INTEGER, updated_at INTEGER, speaker_id TEXT DEFAULT '',
      felt_now_valence REAL, felt_now_arousal REAL, felt_now_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS anchors (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT, salience REAL DEFAULT 1,
      hits INTEGER DEFAULT 1, first_seen INTEGER, last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS event_anchors (
      event_id TEXT NOT NULL, anchor_id TEXT NOT NULL, weight REAL DEFAULT 1,
      PRIMARY KEY (event_id, anchor_id)
    );
    CREATE TABLE IF NOT EXISTS edges (
      src TEXT NOT NULL, dst TEXT NOT NULL, relation TEXT DEFAULT 'co-occur',
      weight REAL DEFAULT 1, last_reinforced INTEGER, PRIMARY KEY (src, dst, relation)
    );
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY, seq INTEGER, day TEXT, ts INTEGER, role TEXT, text TEXT,
      speaker_id TEXT DEFAULT '', processed INTEGER DEFAULT 0, created_at INTEGER
    );
  `);
}

function textOf(msg) {
  if (!msg) return "";
  const c = msg.content ?? msg.text ?? msg.message?.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) {
    return c
      .map((p) => (typeof p === "string" ? p : p?.type === "text" ? String(p.text ?? "") : ""))
      .join(" ")
      .trim();
  }
  return "";
}

export function apply(ctx, config = {}) {
  mkdirSync(DATA_DIR, { recursive: true });
  const log = (m) => {
    try {
      ctx.logger?.info?.(`[whale-memory] ${m}`);
    } catch {
      /* 无 logger */
    }
  };

  let db;
  try {
    db = new DatabaseSync(DB_PATH);
    ensureSchema(db);
    log(`库：${DB_PATH}`);
  } catch (err) {
    log(`打不开库，插件停用：${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const maxItems = Number(config.maxItems ?? 5);
  const projectPath = String(config.projectPath ?? join(homedir(), "whale-memory"));

  // 每轮注入（order 放最后，别打断缓存）
  const offSection = ctx.systemPrompt.section({
    name: "whale-memory",
    order: 89_990,
    text: () => {
      try {
        const q = lastUserOf(ctx);
        if (!q) return "";
        const block = recallContext(db, q, { limit: maxItems });
        if (!block) return "";
        return [
          "",
          "【记忆】下面是过去对话里留下来的事，可能不完整、可能有偏差：",
          block,
          "用它理解对方在说什么、指谁、前因后果。数字和结论以〔事实：…〕为准。",
          "记忆里的「对方」= 跟你说话的人；「我」= 过去的你。别搞反。",
          "没有相关记忆就不要编——说「不记得」比编一个强。",
        ].join("\n");
      } catch (err) {
        log(`注入失败：${err instanceof Error ? err.message : String(err)}`);
        return "";
      }
    },
  });

  // 攒对话
  const mounted = new Set();
  let seq = Number(db.prepare("SELECT COALESCE(MAX(seq),0) AS s FROM turns").get()?.s ?? 0);
  const saveTurn = (role, text, sid) => {
    const t = String(text ?? "").trim();
    if (!t) return;
    seq += 1;
    try {
      db.prepare(
        "INSERT INTO turns (id, seq, day, ts, role, text, speaker_id, processed, created_at) VALUES (?,?,?,?,?,?,?,0,?)",
      ).run(rid("tn"), seq, today(), Date.now(), role, t, sid ?? "", Date.now());
    } catch {
      /* 记不上不影响对话 */
    }
  };

  const mountFor = (agent, sid) => {
    if (!agent || !agent.ctx || mounted.has(sid)) return;
    mounted.add(sid);
    try {
      agent.ctx.on("agent/inbox/inserted", (payload) => {
        const txt = textOf(payload?.message ?? payload);
        if (txt) saveTurn("user", txt, sid);
      });
    } catch (err) {
      log(`监听 inbox 失败：${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      agent.ctx.on("agent/turn-stopping", () => {
        try {
          const evs = agent.session?.snapshotEvents?.() ?? [];
          for (let i = evs.length - 1; i >= 0; i -= 1) {
            if (evs[i]?.type === "assistant/message") {
              const txt = textOf(evs[i].data?.message);
              if (txt) saveTurn("assistant", txt, sid);
              break;
            }
          }
        } catch {
          /* 拿不到就算了 */
        }
      });
    } catch (err) {
      log(`监听 turn-stopping 失败：${err instanceof Error ? err.message : String(err)}`);
    }
    log(`已接管会话 ${sid}`);
  };

  const mountAll = () => {
    try {
      for (const a of ctx.agents?.list?.() ?? []) mountFor(a, String(a.id ?? a.sessionId ?? "default"));
    } catch {
      /* 无 agents */
    }
  };
  mountAll();
  const offMount = ctx.setInterval?.(mountAll, 30_000);

  // 工具
  const reg = ctx.tools?.define ?? ctx.tools?.register;
  if (typeof reg === "function") {
    reg.call(ctx.tools, {
      name: "memory_recall",
      description: "查长期记忆里跟这件事有关的记录。想不起对方提过的事时用它。",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      execute: async ({ query }) => recallContext(db, String(query ?? ""), { limit: maxItems }) || "（没有相关记忆）",
    });

    reg.call(ctx.tools, {
      name: "memory_save",
      description: "觉得某件事值得长期记住，就存下来。一条只装一件事。",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      execute: async ({ text }) => {
        const t = String(text ?? "").trim();
        if (t.length < 4) return "太短了，写清楚点";
        try {
          db.prepare(
            `INSERT INTO events (id, day, ts, tier, title, detail, key_facts, created_at, updated_at)
             VALUES (?,?,?, 'detailed', ?, ?, '[]', ?, ?)`,
          ).run(rid("ev"), today(), Date.now(), t.slice(0, 60), t, Date.now(), Date.now());
          return `收录了：${t.slice(0, 30)}`;
        } catch (err) {
          return `没存上：${err instanceof Error ? err.message : String(err)}`;
        }
      },
    });

    reg.call(ctx.tools, {
      name: "memory_recent",
      description: "翻最近的原始对话，检查有没有该记而没记的。",
      parameters: { type: "object", properties: { n: { type: "integer" } } },
      execute: async ({ n }) => {
        const k = Math.min(60, Math.max(5, Number(n) || 20));
        const rows = db.prepare("SELECT role, text, processed FROM turns ORDER BY seq DESC LIMIT ?").all(k);
        if (rows.length === 0) return "还没有任何原始对话";
        const lines = rows
          .reverse()
          .map((r) => `${Number(r.processed) === 0 ? "○" : " "}${r.role === "user" ? "他" : "我"}：${String(r.text).slice(0, 80)}`);
        const pending = rows.filter((r) => Number(r.processed) === 0).length;
        return [`最近 ${rows.length} 轮（○ = 还没整理，共 ${pending} 条）：`, ...lines].join("\n");
      },
    });

    reg.call(ctx.tools, {
      name: "memory_stats",
      description: "看记忆的现状：多少条、分几层、多少待整理。",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        try {
          const tiers = db.prepare("SELECT tier, COUNT(*) AS c FROM events WHERE archived = 0 GROUP BY tier").all();
          const total = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
          const pending = Number(db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get()?.c ?? 0);
          const anchors = Number(db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c ?? 0);
          const edges = Number(db.prepare("SELECT COUNT(*) AS c FROM edges").get()?.c ?? 0);
          const parts = tiers.map((r) => `${r.tier} ${r.c} 条`).join("　") || "（还没记忆）";
          return `总共 ${total} 条　${parts}　锚点 ${anchors} 个/关系 ${edges} 条　待整理 ${pending} 条对话`;
        } catch {
          return "读不出来";
        }
      },
    });
  } else {
    log("宿主没有 tools 接口，跳过工具注册");
  }

  // 夜里整理（唤起外部 CLI，不在这里重复实现抽取）
  const cli = join(projectPath, "src", "cli.ts");
  let lastRun = "";
  const offTimer = ctx.setInterval?.(() => {
    const h = new Date().getHours();
    if (h < 3 || h >= 5 || lastRun === today()) return;
    if (!existsSync(cli)) {
      log(`找不到 ${cli}，跳过整理（设置里配 projectPath）`);
      return;
    }
    lastRun = today();
    log("开始整理…");
    try {
      const child = spawn(process.execPath, [cli, "sleep", "--db", DB_PATH], { stdio: "ignore" });
      child.on("exit", (code) => log(`整理结束（exit ${code}）`));
    } catch (err) {
      log(`整理启动失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, 30 * 60_000);

  // 直接轮询会话事件流 —— 比事件名可靠。
  // snapshotEvents() 里就是 user/message / assistant/message，不用猜钩子叫什么。
  const seen = new Map();
  const pollSession = (sess, sid) => {
    try {
      if (!sess || typeof sess.snapshotEvents !== "function") return;
      const evs = sess.snapshotEvents() || [];
      const from = seen.get(sid) ?? Math.max(0, evs.length - 40);
      for (let i = from; i < evs.length; i += 1) {
        const e = evs[i];
        const t = textOf(e?.data?.message);
        if (!t) continue;
        if (e?.type === "user/message") saveTurn("user", t, sid);
        else if (e?.type === "assistant/message") saveTurn("assistant", t, sid);
      }
      seen.set(sid, evs.length);
    } catch {
      /* 单个会话失败不影响别的 */
    }
  };
  const pollAll = () => {
    try {
      for (const a of ctx.agents?.list?.() ?? []) pollSession(a.session, String(a.id ?? a.sessionId ?? "default"));
    } catch {
      /* 没有 agents */
    }
    try {
      for (const s of ctx.sessions?.list?.() ?? []) pollSession(s, String(s.id ?? "default"));
    } catch {
      /* 没有 sessions */
    }
  };
  pollAll();
  const offPoll = ctx.setInterval?.(pollAll, 20_000);

  ctx.on?.("dispose", () => {
    for (const off of [offSection, offTimer, offMount, offPoll]) {
      try {
        if (typeof off === "function") off();
      } catch {
        /* 忽略 */
      }
    }
    try {
      db.close();
    } catch {
      /* 忽略 */
    }
  });
}

function lastUserOf(ctx) {
  try {
    for (const a of ctx.agents?.list?.() ?? []) {
      const evs = a.session?.snapshotEvents?.() ?? [];
      for (let i = evs.length - 1; i >= 0; i -= 1) {
        if (evs[i]?.type === "user/message") {
          const t = textOf(evs[i].data?.message);
          if (t) return t;
        }
      }
    }
  } catch {
    /* 拿不到就算了 */
  }
  return "";
}
