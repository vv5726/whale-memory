import type { DatabaseSync } from "node:sqlite";
import type { MemoryConfig } from "../types.ts";
import type { LlmAdapter } from "./adapter.ts";
import { insertEventRow, type AnchorIndex } from "../extract.ts";
import { ensureAnchor, linkEventAnchor } from "../anchors.ts";
import { addKnowledge, loadKb } from "../knowledge.ts";
import { aboutPerson } from "../about-person.ts";
import { sceneAnchorFor, eventAnchorFor } from "../scene-anchor.ts";
import { loadTuning } from "../tuning.ts";

/**
 * 新版抽取：一次产出三个仓（事件 / 词 / 人）。
 *
 * 和老版的区别：
 *   ① 一条 = 一件事（六元组），不是一段复述
 *   ② 每条带状态（待确认/已定/…）、证据（msg_id）、价值分（0-10）
 *   ③ 梗和称呼进词库；偏好禁忌进人物库；只有「事」进记忆
 *   ④ 锚点只挂「事」+ 人 + 场景，不再从文本里抽高频词
 */

interface V3Event {
  type?: string;
  title?: string;
  people?: string[];
  time_absolute?: string;
  time_relative?: string;
  place?: string;
  content?: string;
  status?: string;
  next_action?: string;
  evidence?: Array<{ speaker?: string; msg_id?: string; quote?: string }>;
  sensitivity?: string;
  memory_value?: number;
}

interface V3Out {
  events?: V3Event[];
  lexicon?: Array<{ term?: string; meaning?: string; source?: string }>;
  persons?: Array<{ qq?: string; note?: string; strength?: number }>;
}

const ALLOWED_TYPE = new Set(["约定", "待办", "决策", "经历", "信息", "冲突"]);
const ALLOWED_STATUS = new Set(["待确认", "已定", "已发生", "已取消", "需跟进", "仅记录"]);

export function buildV3Messages(
  day: string,
  turns: Array<{ id: string; role: string; text: string; speakerId?: string }>,
  names: { user: string; assistant: string },
): Array<{ role: "system" | "user"; content: string }> {
  const system = [
    "你是朋友群的记忆整理器。不要总结聊天，要把聊天记录提炼成「一件件事」。",
    "",
    "一件事 = 主体 + 事件核 + 时间锚 + 状态 + 证据 + 未来用途",
    "标题 = 主体 + 事件核 + 时间锚（例：A和B约定周六下午露营）",
    "",
    "只输出 JSON：",
    '{"events":[{"type":"约定|待办|决策|经历|信息|冲突","title":"...","people":["QQ号"],',
    '"time_absolute":"2026-10-31 15:00 或 空","time_relative":"周六下午 或 空","place":"... 或 空",',
    '"content":"一句话说清楚发生了什么","status":"待确认|已定|已发生|已取消|需跟进|仅记录",',
    '"next_action":"谁该做什么 或 空","evidence":[{"speaker":"QQ号","msg_id":"消息编号","quote":"原话"}],',
    '"sensitivity":"normal|private|high","memory_value":0到10}],',
    '"lexicon":[{"term":"词或梗","meaning":"它是什么意思","source":"谁说的/哪来的"}],',
    '"persons":[{"qq":"QQ号","note":"关于这个人的偏好/禁忌","strength":0到2}]}',
    "",
    "规则：",
    "1. 同一件事跨多条消息必须合并；不同结果、不同时间、不同人物组合必须拆开。",
    "2. 缺失就写空字符串，不许编造。",
    "3. 相对时间结合消息日期换算，同时保留原话；算不准就留空。",
    "4. events 的 type 只能是：约定/待办/决策/经历/信息/冲突。",
    "5. 梗、黑话、群规、称呼 → 放进 lexicon，不要放进 events。",
    "6. 某人的偏好、忌口、习惯 → 放进 persons，不要放进 events。",
    "7. 每条 event 至少一条 evidence，msg_id 必须抄消息前面的编号，不许自己编。",
    "8. 纯情绪、无对象的感叹、刷屏 → 不记。",
    "9. memory_value 0-10：未来可能被问起 2、涉及人或情绪 2、有时效会变 2、证据明确 2、重复出现或状态变化 2。",
    `10. 说话人一律用 QQ 号：他 = ${names.user}，你自己 = ${names.assistant}。`,
    "11. evidence.speaker 必须填消息前面那个 QQ 号；那条消息标的是「（没标说话人）」就留空。",
    "    绝对不要写「他」「她」「我」「你」——那不是人，是代词，存进库里以后没人认得出是谁。",
  ].join("\n");

  const user = [
    `日期：${day}`,
    "聊天记录（每条前面 [方括号] 里是消息编号，evidence.msg_id 必须用它）：",
    // 没标说话人的别再写成「他」：模型会把这个标签当成说话人抄进 evidence.speaker，
    // 库里就会出现 speaker_id = "他" 这种事（2026-10-26 查出 11 条）。
    ...turns.map((t) => `[${t.id}] ${t.speakerId || (t.role === "user" ? "（没标说话人）" : "凝")}: ${t.text}`),
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function parseV3(raw: string): V3Out | null {
  try {
    const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
    const body = fence?.[1] ?? raw;
    const a = body.indexOf("{");
    const b = body.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    return JSON.parse(body.slice(a, b + 1)) as V3Out;
  } catch {
    return null;
  }
}

export async function extractDayV3(
  db: DatabaseSync,
  cfg: MemoryConfig & { dataDir?: string },
  index: AnchorIndex,
  adapter: LlmAdapter,
  day: string,
  turns: Array<{ id: string; role: string; text: string; speakerId?: string }>,
  names: { user: string; assistant: string },
): Promise<{ inserted: number; reinforced: number; rejected: number; newAnchors: number; frozen: boolean }> {
  const messages = buildV3Messages(day, turns, names);
  let raw = "";
  try {
    raw = await adapter.complete(messages, { json: true, timeoutMs: cfg.llmTimeoutMs ?? 120_000, temperature: 0.3 });
  } catch {
    return { inserted: 0, reinforced: 0, rejected: 0, newAnchors: 0, frozen: false };
  }

  const out = parseV3(raw);
  if (!out) return { inserted: 0, reinforced: 0, rejected: turns.length, newAnchors: 0, frozen: false };

  // 证据白名单：msg_id 必须真在 turns 里
  const known = new Set(turns.map((t) => t.id));
  const dataDir = String(cfg.dataDir ?? "data");
  const baseTs = Date.parse(`${day}T12:00:00Z`) || Date.now();

  // 记多少由她自己调：价值门槛 + 一批上限
  const tune = loadTuning(dataDir);
  const minValue = tune.v3MinValue;
  const maxEvents = tune.v3MaxEvents;

  let inserted = 0;
  let rejected = 0;
  let newAnchors = 0;

  // ① 事件
  for (const [i, e] of (out.events ?? []).entries()) {
    const title = String(e.title ?? "").trim();
    if (title.length < 3) {
      rejected += 1;
      continue;
    }
    const evs = (e.evidence ?? []).filter((x) => known.has(String(x.msg_id ?? "")));
    const fakeEvidence = evs.length < (e.evidence ?? []).length;
    const value = Math.max(0, Math.min(10, Number(e.memory_value ?? 0) || 0));

    // 低于她设的价值门槛 → 不记（她可以自己调这个数）
    if (value < minValue) {
      rejected += 1;
      continue;
    }

    const detailParts = [String(e.content ?? "").trim()];
    if (e.next_action) detailParts.push(`下一步：${String(e.next_action)}`);
    if (e.time_relative) detailParts.push(`原话时间：${String(e.time_relative)}`);

    if (inserted >= maxEvents) break;
    const ts = baseTs + i * 60_000;
    const row = insertEventRow(
      db,
      {
        day,
        ts,
        tier: "detailed",
        stage: "extracted",
        title: title.slice(0, 60),
        detail: detailParts.filter(Boolean).join("　").slice(0, 600),
        cause: null,
        effect: null,
        coreFragment: null,
        affect: { valence: 0, arousal: 0.3, tags: [], summary: "" },
        keyFacts: [],
        anchors: [],
        strength: 1,
        mentions: 1,
        derivedFrom: [],
        contextKinds: ["v3"],
        speakerId: String(e.people?.[0] ?? ""),
      } as never,
      cfg,
      ts,
      "",
      null,
      null,
    );
    inserted += 1;

    // 新字段回填
    db.prepare(
      `UPDATE events SET etype=?, status=?, responsible=?, time_absolute=?, time_relative=?,
        place=?, evidence=?, sensitivity=?, memory_value=? WHERE id=?`,
    ).run(
      ALLOWED_TYPE.has(String(e.type)) ? String(e.type) : "信息",
      ALLOWED_STATUS.has(String(e.status)) ? String(e.status) : "仅记录",
      String(e.next_action ?? "").slice(0, 60),
      String(e.time_absolute ?? "").slice(0, 40),
      String(e.time_relative ?? "").slice(0, 40),
      String(e.place ?? "").slice(0, 40),
      JSON.stringify(
        evs.map((x) => ({ speaker: String(x.speaker ?? ""), msg_id: String(x.msg_id ?? ""), quote: String(x.quote ?? "").slice(0, 80) })),
      ),
      fakeEvidence ? "low-confidence" : String(e.sensitivity ?? "normal"),
      value,
      row.id,
    );

    // 锚点：人（people 里的）+ 场景，仅此两类。
    // 单个锚点挂不上不该炸掉整批——外面有 20 批要跑。
    try {
      for (const p of e.people ?? []) {
        const qq = String(p ?? "").trim();
        if (!/^\d{5,}$/.test(qq)) continue;
        const a = ensureAnchor(db, qq, "person", Date.now());
        if (a) {
          linkEventAnchor(db, row.id, a, 1.0);
          newAnchors += 1;
        }
      }
    } catch (err) {
      console.log("  [v3] 挂人锚点失败：" + (err instanceof Error ? err.message : String(err)));
    }
    try {
      // 事锚点：从标题长出来。没有它，锚点网络里就没有「事情」这一层。
      const ev = eventAnchorFor(db, title);
      if (ev) linkEventAnchor(db, row.id, ev, 1.5);
    } catch (err) {
      console.log("  [v3] 挂事锚点失败：" + (err instanceof Error ? err.message : String(err)));
    }
    try {
      // 事锚点：从标题长出来。没有它，锚点网络里就没有「事情」这一层。
      const ev = eventAnchorFor(db, title);
      if (ev) linkEventAnchor(db, row.id, ev, 1.5);
    } catch (err) {
      console.log("  [v3] 挂事锚点失败：" + (err instanceof Error ? err.message : String(err)));
    }
    try {
      // 事锚点：从标题长出来。没有它，锚点网络里就没有「事情」这一层。
      const ev = eventAnchorFor(db, title);
      if (ev) linkEventAnchor(db, row.id, ev, 1.5);
    } catch (err) {
      console.log("  [v3] 挂事锚点失败：" + (err instanceof Error ? err.message : String(err)));
    }
    try {
      const scene = sceneAnchorFor(db, turns[0]?.speakerId ? "private" : "group", day);
      if (scene) linkEventAnchor(db, row.id, scene, 0.5);
    } catch (err) {
      console.log("  [v3] 挂场景锚点失败：" + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ② 词库
  const kb = loadKb(dataDir);
  const have = new Set(kb.entries.map((x) => x.title));
  for (const l of out.lexicon ?? []) {
    const term = String(l.term ?? "").trim();
    const meaning = String(l.meaning ?? "").trim();
    if (term.length < 1 || meaning.length < 2) continue;
    if (have.has(term)) continue;
    addKnowledge(dataDir, { category: "梗", title: term, content: meaning, source: String(l.source ?? "") });
  }

  // ③ 人物
  for (const p of out.persons ?? []) {
    const qq = String(p.qq ?? "").trim();
    const note = String(p.note ?? "").trim();
    if (!/^\d{5,}$/.test(qq) || note.length < 2) continue;
    aboutPerson(db, { person: qq, content: note });
  }

  return { inserted, reinforced: 0, rejected, newAnchors, frozen: false };
}
