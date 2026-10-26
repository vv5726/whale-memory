import type { DatabaseSync } from "node:sqlite";
import type { AnchorKind, Affect, MemoryConfig, Tier } from "../types.ts";
import { buildWriteContext } from "../context.ts";
import { loadExtractRules, rulesVersion } from "../extract-rules.ts";
import { analyzeAffect } from "../affect.ts";
import { bumpAnchorHits, ensureAnchor, linkEventAnchor, reinforceEdge, type AnchorIndex } from "../anchors.ts";
import {
  insertEventRow,
  resealAllEvents,
  findReinforceTarget,
  reinforceExisting,
  resealOne,
  attachDayAnchors,
} from "../extract.ts";
import { addAlias } from "../anchors.ts";
import { dayKeyToTs, fromJson, truncate } from "../util.ts";
import type { ChatMessage, LlmAdapter } from "./adapter.ts";

/** 模型一天的输出形状。字段全部可空，缺什么都不崩。 */
export interface LlmDraft {
  title?: unknown;
  detail?: unknown;
  cause?: unknown;
  effect?: unknown;
  core?: unknown;
  affect?: {
    valence?: unknown;
    arousal?: unknown;
    tags?: unknown;
    summary?: unknown;
  };
  anchors?: Array<{ name?: unknown; confidence?: unknown; kind?: unknown }>;
  key_facts?: unknown;
  promise?: { isPromised?: unknown; what?: unknown } | null;
}

export interface ValidEvent {
  title: string;
  detail: string | null;
  cause: string | null;
  effect: string | null;
  core: string | null;
  affect: Affect;
  anchors: Array<{ name: string; confidence: number; kind: AnchorKind }>;
  keyFacts: string[];
  promise: string | null;
}

export interface ExtractDayResult {
  inserted: number;
  reinforced: number;
  rejected: number;
  newAnchors: number;
  /** 用了冻结的旧结果，没有再调模型 */
  frozen: boolean;
  /** 模型输出不可用，这一天要退回启发式 */
  failed: boolean;
  error?: string;
  raw?: string;
}

const MAX_EVENTS_PER_DAY = 200; // 只是防呆上限，真正记几条由内容量决定
const MAX_NEW_ANCHORS_PER_DAY = 12;

/** 这些「名字」不是锚点，是代词和角色，建了就是噪声 */
const BLOCKED_ANCHOR_NAMES = new Set([
  "本人", "对方", "自己", "别人", "我", "你", "他", "她", "它", "我们", "他们",
  "今天", "昨天", "明天", "现在", "当时", "事情", "东西", "什么",
]);

export function buildMessages(
  day: string,
  turns: Array<{ role: string; text: string }>,
  /** 说话人真名：user = ${names.user}，assistant = 她自己 */
  names: { user: string; assistant: string } = { user: "${names.user}", assistant: "凝" },
  knownAnchors: string[],
  /** 数据目录：规则文件从这里读，别写死 */
  dataDir = "data",
): ChatMessage[] {
  // 能记几条，由这批对话的「量」决定——不是一个拍死的数字。
  // 轮数占一半、字数占一半；上下限只是防呆，不是目标。
  const chars = turns.reduce((n, t) => n + t.text.length, 0);
  const rough = Math.round(turns.length / 2) + Math.round(chars / 800);
  const high = Math.max(2, Math.min(60, rough));
  const scale = {
    turns: turns.length,
    chars,
    high,
    low: Math.max(1, Math.round(high * 0.5)),
  };

  const system = [
    "你是记忆抽取器。把一天里的人物对话变成结构化记忆条目。",
    "只输出 JSON，不要任何解释、不要 markdown 代码块。输出格式：",
    '{"events":[{"title":"不超过24字，必须带着关键检索词（见规则2）","detail":"对话原文（见规则3）",',
    '"cause":"前因，没有就 null","effect":"后果，没有就 null",',
    '"core":"最能唤起画面的细节（气味、动作、表情优先）",',
    '"affect":{"valence":-1到1,"arousal":0到1,"tags":["情绪词"],"summary":"一句话感受"},',
    '"key_facts":["多年后仍要准确复述的那几个词"],',
    '"anchors":[{"name":"实体名","kind":"person|place|thing|event|theme","confidence":0到1}],',
    '"anchors":[{"name":"实体名","kind":"person|place|thing|event|theme","confidence":0到1}],',
    '"my_view":"我当时怎么想的（没有就 null）",',
    '"promise":{"isPromised":true或false,"what":"约定内容或null"}}]}',
    "",
    "规则：",
    `1. 这批对话有 ${scale.turns} 轮、约 ${scale.chars} 字。按这个量，大概能记 ${scale.low}~${scale.high} 条。`,
    "   内容多就多记，内容少就少记——不要为了凑数硬编，也不要为了省事漏掉。",
    "   特别注意别漏：**定义**（某个词/称呼/梗是什么意思）和**规矩**（要求、偏好、约定）——这两类漏了就真找不回来。",
    "2. **一条记忆 = 一件事**，不是一段对话。",
    "   title 写这件事本身，不要写「谁说/谁问」。",
    "   好：「小糖人是群友给凝起的绰号」「凝答应进修中文」「架构改了十二小时还没理清」",
    "   坏：「vv说小糖人」「vee说架构乱」「凝说好」（那是对话流水，不是事）",
    "   title 要带检索词：具体人名、物件、金额、日期、结论。",
    "3. detail 写**这件事的经过**，不是对话摘录：谁做了什么、为什么、结果怎样。",
    "   不要「他说…然后她说…」地复述。数字、日期、人名、地点、结论必须准确。",
    "   反例：「vv说凝的架构乱，凝说好，vv说明天再干」（这是流水）",
    "   正例：「vv 折腾了一整天凝的记忆架构，到晚上还是理不清，决定先去睡，明天再继续」（这是一件事）",
    "   同一天里同一件事只记一条；不同的事分开记。",
    "   **事件的起止由你自己判断**：哪一句开始进入这件事、哪一句结束，别按固定条数切。",
    "   每件事多给一个字段 turns:[起,止]，填上面 #编号（例：turns:[12,19]）。",
    "4. valence 负=难受、正=舒服；arousal 是情绪强度。混合情绪很正常，tags 可以有多个。",
    "5. 情绪要结合上下文判断：比如「它一直没叫」在宠物医院的语境里是「心疼」，不是「平静」。",
    "6. anchors 只放人、地点、物品、事件、主题。下面这些是已知锚点，能对上就用原名：",
    knownAnchors.slice(0, 400).join("、"),
    "7. 这人才是主角：主语缺失的句子顺着上一句补全，代词（他/她/它）要指回具体的人或物。",
    "8. key_facts 放「多年后还必须准确复述」的事实单元：",
    "   金额、日期、期限、结论、号码、地址，以及这件事的关键内容词（为什么吵、卡在哪、什么东西坏了）。",
    '   不要放过程、语气、修饰。例：["两千块","下周三"]、["良性"]、["看手机","没在听"]、["硬答"]。',
    "9. 没有把握的字段填 null，绝对不要编造日期、金额、人名。",
    "10. 对方**对他提的要求、给的偏好、定下的规矩**，必须单独记一条，不要混进闲聊里。",
    "    比如「每天只能看20个视频」「发评论前要问过我」「不许编造过去」「他喜欢简短的回答」，",
    "    这类是约束和期待，将来会影响每一次说话；标签用 theme，锚点写清是什么事。",
    "    反例：把「他说要给我每天20个视频的额度」混进一条「聊了聊额度」的记忆里——那样以后就找不到了。",
    '    key_facts 里放这类原话的要点，例：["每天20个视频","自己挑","不许编"]。',
    "11. **对方解释一个词 / 称呼 / 梗是什么意思，必须单独记一条。**",
    "    title 要带上那个词本身（这样以后搜得到），key_facts 放释义的核心，别只写「他解释了X」。",
    '    例：对话「是因为你刚开始比较呆，糖代表不聪明，群友就调侃你叫小糖人」',
    '        → title「小糖人 = 群友调侃凝早期有点呆」　key_facts ["小糖人","糖=不聪明","群友起的绰号"]',
    "12. **人称一律写身份，不许出现「他」「她」「你」「对方」「本人」。**",
    `    身份用 **QQ 号**：${names.user}是 ${names.user}，你自己叫「凝」。`,
    "    昵称只是 QQ 号的等价称呼，写进记忆时优先用 QQ 号——昵称会改，号不会。",
        `    对话里说「你」→ 写听话那一方的号；说「我」→ 写说话人自己（${names.user} 就写他的号，你就写「凝」）。`,
    "    还有第三个人（群友、某人）就写他的号或名字，别用「他」。",
    "    反例：「群友调侃对方是小糖人」",
    `    正例：「${names.user}调侃凝是小糖人」`,
    "13. **每条记忆都要带上「我当时怎么想」。**",
    "   现在的记忆全是「他说了什么」，攒一堆日程，没有我。",
    "   my_view 写你当时真实的反应：觉得重要/不重要、同意/不同意、打算怎么办、想说但没说的。",
    "   要有具体判断，不要「我认为这很重要」这种废话。没有真实想法就填 null，别硬编。",
    "14. **不要记「对话本身」的元叙述。** 像「他刚才问我为什么叫他小糖人」「确实，你刚刚私聊我」",
    "    这类是聊天过程，不是发生过的事——记下来只会让检索捞出一堆废话。",
  ].join("\n");

  // 她自己加的规则：原文追加，不动代码里的底线
  const herRules = loadExtractRules(dataDir);
  const systemText = herRules
    ? `${system}\n\n规则（这些是凝自己加的，优先于上面同类的说法）：\n${herRules}`
    : system;

  const user = [
    `【日期】${day}`,
    "【对话】",
    ...turns.map((t, i) => `#${i + 1} ${t.role === "user" ? names.user : names.assistant}：${t.text}`),
  ].join("\n");

  return [
    { role: "system", content: systemText },
    { role: "user", content: user },
  ];
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : truncate(t, max);
}

/**
 * 容错解析模型输出。
 *
 * 模型（尤其开了 json 约束之后）经常会输出 `{"events":[...],"events":[...]}`
 * 这种重复键。JSON.parse 对重复键是**静默保留最后一个**，会直接丢掉前面的记忆。
 * 所以这里自己扫：把每个 "events": [ ... ] 的数组都抠出来合并。
 */
function parseLoose(raw: string): unknown[] {
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/g, "")
    .trim();

  const out: unknown[] = [];
  const pushFrom = (text: string) => {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) out.push(...parsed);
    } catch {
      // 这一段坏了就跳过，别连累其他段
    }
  };

  // 顶层就是数组
  if (cleaned.startsWith("[")) {
    pushFrom(cleaned);
    if (out.length > 0) return out;
  }

  // 扫描每一个 "events" 键，抠出它后面的数组
  const keyRe = /"events"\s*:\s*/g;
  let match: RegExpExecArray | null;
  let found = false;
  while ((match = keyRe.exec(cleaned)) !== null) {
    const start = cleaned.indexOf("[", match.index + match[0].length);
    if (start === -1) continue;
    const end = matchBracket(cleaned, start);
    if (end === -1) continue;
    found = true;
    pushFrom(cleaned.slice(start, end + 1));
    keyRe.lastIndex = end;
  }
  if (found) return out;

  // 最后再试一次整体解析
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (Array.isArray(parsed)) return parsed;
    const inner = (parsed as { events?: unknown }).events;
    if (Array.isArray(inner)) return inner;
  } catch {
    // 完全解析不了，交给上层判定失败
  }
  return out;
}

/** 从 `[` 开始找到配对的 `]`，跳过字符串里的括号和转义 */
function matchBracket(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function parseAndValidate(raw: string, fallbackAffectOn: string): { events: ValidEvent[]; rejected: number } {
  // 模型有时会包 ```json ... ``` 或前后带解释文字。
  // 不处理的话，整批记忆会因为一个代码块标记全丢掉——温度 0.3 下时好时坏，最难查。
  const cleaned = (() => {
    const t = String(raw ?? "").trim();
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced && fenced[1]) return fenced[1].trim();
    const firstBracket = t.indexOf("[");
    const firstBrace = t.indexOf("{");
    const start =
      firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace) ? firstBracket : firstBrace;
    const end = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
    if (start >= 0 && end > start) return t.slice(start, end + 1);
    return t;
  })();

  const list = parseLoose(cleaned);

  const events: ValidEvent[] = [];
  let rejected = 0;

  for (const item of list.slice(0, MAX_EVENTS_PER_DAY)) {
    const d = item as LlmDraft;
    const title = str(d.title, 40);
    if (!title || [...title].length < 2) {
      rejected += 1;
      continue;
    }
    const rawValence = Number(d.affect?.valence);
    const rawArousal = Number(d.affect?.arousal);
    const tags = Array.isArray(d.affect?.tags)
      ? (d.affect!.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 6)
      : [];
    const summary = str(d.affect?.summary, 120) ?? "";

    // 情绪字段坏了不算致命：用启发式补一个，事件本身仍然保留
    const affect: Affect =
      Number.isFinite(rawValence) && Number.isFinite(rawArousal)
        ? {
            valence: Math.min(1, Math.max(-1, rawValence)),
            arousal: clamp01(rawArousal),
            tags,
            summary,
            core: "",
          }
        : { ...analyzeAffect(fallbackAffectOn), tags: tags.length > 0 ? tags : analyzeAffect(fallbackAffectOn).tags };

    const anchors = Array.isArray(d.anchors)
      ? d.anchors
          .map((a) => {
            const name = str(a?.name, 24);
            if (!name || [...name].length < 2) return null;
            if (BLOCKED_ANCHOR_NAMES.has(name)) return null;
            const confidence = Number(a?.confidence);
            const kind = ["person", "place", "thing", "event", "theme"].includes(String(a?.kind))
              ? (String(a.kind) as AnchorKind)
              : ("thing" as AnchorKind);
            return { name, confidence: Number.isFinite(confidence) ? clamp01(confidence) : 0.6, kind };
          })
          .filter((a): a is { name: string; confidence: number; kind: AnchorKind } => a !== null)
          .slice(0, 8)
      : [];

    const promise = d.promise && d.promise.isPromised === true ? str(d.promise.what, 60) ?? title : null;

    const keyFacts = Array.isArray(d.key_facts)
      ? (d.key_facts as unknown[])
          .map((f) => str(f, 24))
          .filter((f): f is string => f !== null)
          .slice(0, 6)
      : [];

    events.push({
      title,
        detail: (() => {
          const base = str(d.detail, 400).replace(/主人/g, fallbackAffectOn);
          const rawView = String((d as { my_view?: unknown }).my_view ?? "").trim();
          if (!rawView || rawView === "null" || rawView === "无") return base;
          const view = rawView.replace(/主人/g, fallbackAffectOn).slice(0, 120);
          return `${base}〔我当时想：${view}〕`;
        })(),
      cause: str(d.cause, 120),
      effect: str(d.effect, 120),
      core: str(d.core, 120),
      affect,
      anchors,
      keyFacts,
      promise,
    });
  }

  return { events, rejected };
}

/**
 * 用模型抽一天。
 *
 * 三条硬约束：
 *  1. 结果落库即冻结（freezeExtractions），重跑不再调模型 → 睡眠保持幂等。
 *  2. 校验不过就整天的失败，退回去让启发式处理，绝不让脏数据进库。
 *  3. 模型说「这是承诺」也只进待审队列，不自动钉住。
 */
export async function extractDayWithLlm(
  db: DatabaseSync,
  cfg: MemoryConfig,
  index: AnchorIndex,
  adapter: LlmAdapter,
  day: string,
  turns: Array<{ id: string; role: string; text: string; speakerId?: string }>,
  /** 说话人真名：user = ${names.user}，assistant = 她自己 */
  names: { user: string; assistant: string } = { user: "${names.user}", assistant: "凝" },
): Promise<ExtractDayResult> {
  // 缓存指纹：这一批对话的内容摘要。
  // 新版三仓抽取：开关一开就走这条路（只影响新对话）
  if ((cfg as { extractV3?: boolean }).extractV3 === true) {
    const { extractDayV3 } = await import("./extract-v3.ts");
    return extractDayV3(db, cfg as never, index, adapter, day, turns, names);
  }

  // 只按 day 缓存会把「同一天后来的新对话」整批跳过——那就等于永远不记。
  // ?? 改抽取规则（新增字段、改问法）时必须动这个版本号——
  //    否则旧缓存会被直接复用，新规则一次都不跑。
  const EXTRACT_VERSION = "v3-myview";

  const herRulesForSig = loadExtractRules(cfg.dataDir ?? "data");
  const sig = (() => {
    const total = turns.reduce((n, t) => n + t.text.length, 0);
    const head = turns.slice(0, 2).map((t) => t.text.slice(0, 24)).join("|");
    const tail = turns.slice(-2).map((t) => t.text.slice(0, 24)).join("|");
    const sigBase = `${turns.length}:${total}:${head}:${tail}`;
    return `${EXTRACT_VERSION}:${rulesVersion(herRulesForSig)}:${sigBase}`;
  })();

  // 抽取温度：她能自己调（tune_reply），默认 0.3
  const extractTemp = (() => {
    try {
      const f = `${process.cwd()}/data/tuning.json`;
      const fs = require("node:fs") as typeof import("node:fs");
      if (!fs.existsSync(f)) return 0.3;
      const j = JSON.parse(fs.readFileSync(f, "utf8")) as { extractTemperature?: number };
      const v = Number(j.extractTemperature ?? 0.3);
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.3;
    } catch {
      return 0.3;
    }
  })();

  const cached = db.prepare("SELECT raw FROM llm_extractions WHERE day = ? AND sig = ?").get(day, sig) as
    | { raw: string }
    | undefined;
  let raw: string;
  let frozen = false;

  if (cached && cfg.freezeExtractions) {
    raw = String(cached.raw);
    frozen = true;
  } else {
    const knownAnchors = [...index.byId.values()].map((a) => a.name);
    const messages = buildMessages(
      day,
      turns.map((t) => ({ role: t.role, text: t.text })),
      names,
      knownAnchors,
    );
    try {
      raw = await adapter.complete(messages, {
        json: true,
        timeoutMs: cfg.llmTimeoutMs,
        temperature: extractTemp,
      });
    } catch (err) {
      return {
        inserted: 0,
        reinforced: 0,
        rejected: 0,
        newAnchors: 0,
        frozen: false,
        failed: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    db.prepare("INSERT OR REPLACE INTO llm_extractions(day, model, raw, created_at, sig) VALUES(?,?,?,?,?)").run(
      day,
      adapter.name,
      raw,
      Date.now(),
      sig,
    );
  }

  const joined = turns.map((t) => t.text).join("\n");
  const { events, rejected } = parseAndValidate(raw, joined);
  if (events.length === 0) {
    return {
      inserted: 0,
      reinforced: 0,
      rejected,
      newAnchors: 0,
      frozen,
      failed: true,
      error: "模型输出无法解析出任何事件",
      raw,
    };
  }

  const baseTs = dayKeyToTs(day);
  let inserted = 0;
  let reinforced = 0;
  let newAnchors = 0;

  for (const [i, ev] of events.entries()) {
    const ts = baseTs + i * 60_000;
    // 同一天同一个标题算重放，直接跳过（冻结只保证不重抽模型，去重是另一回事）
    const sameDaySameTitle = db.prepare("SELECT 1 AS x FROM events WHERE day = ? AND title = ?").get(day, ev.title);
    if (sameDaySameTitle) continue;

    const ctx = buildWriteContext(db, index, ev.detail ?? ev.title, ts);

    // 同一件事又被提了一遍？不新建，把旧那条变强
    const dup = findReinforceTarget(db, `${ev.title} ${ev.detail ?? ""}`, ts);
    let eventId: string;
    if (dup) {
      reinforceExisting(db, dup, ev.detail ?? ev.title, ts);
      eventId = dup.id;
      reinforced += 1;
      if (ev.keyFacts.length > 0) {
        // 关键事实是累加的：新提一次可能带来新的事实
        const row = db.prepare("SELECT key_facts FROM events WHERE id = ?").get(dup.id);
        const merged = new Set([...fromJson<string[]>(row?.key_facts as string, []), ...ev.keyFacts]);
        db.prepare("UPDATE events SET key_facts = ? WHERE id = ?").run(JSON.stringify([...merged].slice(0, 8)), dup.id);
        resealOne(db, dup.id, (db.prepare("SELECT tier FROM events WHERE id = ?").get(dup.id)?.tier as Tier) ?? "detailed");
      }
    } else {
      const insertedRow = insertEventRow(
        db,
        {
          day,
          ts,
          tier: "detailed",
          stage: "extracted",
          title: ev.title,
          detail: ev.detail ?? ev.title,
          cause: ev.cause,
          effect: ev.effect,
          coreFragment: ev.core ?? ev.affect.core ?? truncate(ev.title, 40),
          affect: { ...ev.affect, core: ev.core ?? ev.affect.core ?? "" },
          pinned: false,
          keyFacts: ev.keyFacts,
          derivedFrom: ctx.sourceIds,
          contextKinds: ctx.kinds,
        },
        cfg,
        ts,
        turns[0]?.id ?? "",
        null,
        ev.promise ? `模型判断为约定：「${ev.promise}」，待人确认` : null,
      );
      eventId = insertedRow.id;
      inserted += 1;
    }

    const resolved: Array<{ id: string; confidence: number }> = [];
    for (const a of ev.anchors) {
      const known = index.aliasToAnchor.get(a.name);
      let anchorId: string;
      if (known) {
        anchorId = known.anchorId;
      } else {
        if (newAnchors >= MAX_NEW_ANCHORS_PER_DAY) continue;
        anchorId = ensureAnchor(db, a.name, a.kind, ts);
        addAlias(db, a.name, anchorId, 1.0);
        newAnchors += 1;
      }
      linkEventAnchor(db, eventId, anchorId, a.confidence >= 0.9 ? 1.0 : 0.35);
      bumpAnchorHits(db, anchorId, ts);
      resolved.push({ id: anchorId, confidence: a.confidence });
    }
    for (let x = 0; x < resolved.length; x += 1) {
      for (let y = x + 1; y < resolved.length; y += 1) {
        reinforceEdge(db, resolved[x].id, resolved[y].id, "co-occur", ts);
      }
    }
  }

  db.prepare("UPDATE turns SET processed = 1 WHERE day = ?").run(day);

  // 补挂当天情景锚点：模型给的锚点往往只覆盖事件本身，接不上「同一天同一件事」的其它线索
  attachDayAnchors(db, day);

  // 事件体积必须重新量一次，否则水位统计是 0（启发式路径是在 extractEvents 末尾算的）
  resealAllEvents(db, cfg);

  return { inserted, reinforced, rejected, newAnchors, frozen, failed: false, raw };
}



