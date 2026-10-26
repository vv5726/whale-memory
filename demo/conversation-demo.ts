/**
 * 连续对话演示 —— 全部虚构人物，跑的是真模型（DeepSeek）真检索。
 *
 * 跑法：
 *   node demo/conversation-demo.ts
 *
 * 需要 key：优先读环境变量 DEEPSEEK_API_KEY，其次读 data/bot.json 的 deepseekApiKey。
 * 没有 key 时会退化成「只显示检索到什么」，不调模型——一样能看检索效果。
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "../src/db.ts";
import { recordOwnNote } from "../src/notes.ts";
import { recall } from "../src/recall.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { buildChatPrompt } from "../src/bot/persona.ts";

const DAY = 86_400_000;
const now = Date.now();
const dir = "data/demo-conversation";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(join(dir, "memory.db"));
migrate(db);
const cfg = { ...DEFAULT_CONFIG, dataDir: dir };

// —— 三周前开始的一些事（虚构）——
const notes: Array<[number, string]> = [
  [21, "阿臻说最近连着两周加班到十一点，想辞职"],
  [20, "阿臻决定先不辞职，留下来熬过房贷这两年"],
  [19, "老周问阿臻借了两千块，说下个月发工资还"],
  [18, "阿臻和老周因为借钱的事吵了一架，老周一直装忘"],
  [17, "吵完阿臻主动找老周，说不是催钱，是觉得自己被忽视"],
  [15, "阿臻定了「每天读一小时」的计划，想补技术"],
  [13, "阿臻把计划改成一周三次，说别把自己逼太紧"],
  [10, "阿臻说最烦的就是被人当工具用，不是讨厌这份工作"],
  [7, "老周还了一千，剩一千说下个月"],
  [3, "阿臻把读书计划改成通勤路上听一听"],
  [2, "老周把剩下的一千还了，还请阿臻吃了顿饭"],
];
for (const [d, text] of notes) recordOwnNote(db, text, now - d * DAY);

// 锚点（真实使用里是抽出来的；这里手动挂，让联想看得见）
const ANCHORS: Array<[string, string[]]> = [
  ["工作", ["辞职", "加班", "被当工具"]],
  ["老周", ["老周", "借钱"]],
  ["读书计划", ["读一小时", "读书", "通勤路上听"]],
];
for (const [name, keys] of ANCHORS) {
  const id = "anc_demo2_" + name;
  db.prepare("INSERT OR REPLACE INTO anchors (id, name, kind, salience, hits, first_seen, last_seen, external_id) VALUES (?, ?, 'event', 1.0, 1, ?, ?, '')").run(id, name, now - 21 * DAY, now);
  for (const r of db.prepare("SELECT id, title FROM events").all() as Array<{ id: string; title: string }>) {
    if (keys.some((k) => String(r.title).includes(k))) {
      db.prepare("INSERT OR REPLACE INTO event_anchors (event_id, anchor_id, weight, role) VALUES (?, ?, 1.0, 'subject')").run(r.id, id);
    }
  }
}

// —— key ——
let key = process.env.DEEPSEEK_API_KEY ?? "";
let base = "https://api.deepseek.com/v1";
let model = "deepseek-chat";
if (!key && existsSync("data/bot.json")) {
  try {
    const bot = JSON.parse(readFileSync("data/bot.json", "utf8")) as { deepseekApiKey?: string; deepseekBaseUrl?: string; deepseekModel?: string };
    key = String(bot.deepseekApiKey ?? "");
    base = String(bot.deepseekBaseUrl ?? base);
    model = String(bot.deepseekModel ?? model);
  } catch {
    /* ignore */
  }
}

const selfText = existsSync("personas/free/self.md") ? readFileSync("personas/free/self.md", "utf8") : "";

async function chat(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string> {
  const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: 0.9, max_tokens: 260 }),
    signal: AbortSignal.timeout(90_000),
  });
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? "api error");
  return String(j.choices?.[0]?.message?.content ?? "").trim();
}

const TURNS = [
  "今天又加班到十一点，烦",
  "你说我当初是不是不该留下来",
  "老周那事儿你还记得吗",
  "我那个读书计划是不是又废了",
  "算了，不聊这个了。你还记得我最烦什么吗",
];

console.log(`模式：${key ? "真模型 " + model : "无 key（只演示检索）"}\n`);
const history: Array<{ role: "user" | "assistant"; content: string }> = [];

for (const line of TURNS) {
  const mem = recall(db, cfg, line, { nowTs: now });
  const hits = (mem.scored ?? []).slice(0, 2).map((t) => String((t as { title?: string }).title ?? "").slice(0, 34));
  console.log(`阿臻：${line}`);
  if (hits.length > 0) console.log(`  （她想起：${hits.join(" ／ ")}）`);
  else console.log("  （她没想起什么）");

  if (!key) {
    console.log("她：（没 key，跳过模型）\n");
    continue;
  }
  const messages = buildChatPrompt({
    memory: mem,
    userName: "阿臻",
    history,
    message: line,
    memoryWeak: false,
    selfText,
  }) as Array<{ role: "system" | "user" | "assistant"; content: string }>;
  // buildChatPrompt 里可能有空 content 的占位，发之前滤掉
  const clean = messages.filter((m) => typeof m.content === "string" && m.content.trim().length > 0);
  const reply = await chat(clean);
  history.push({ role: "user", content: line }, { role: "assistant", content: reply });
  console.log(`她：${reply}\n`);
}

console.log("注：人物、金额、事件全部虚构；记忆是现场建的临时库，跑完即删。");
db.close();
rmSync(dir, { recursive: true, force: true });
