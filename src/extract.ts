import type { DatabaseSync } from "node:sqlite";
import type { EventRow, MemoryConfig, Tier } from "./types.ts";
import { analyzeAffect } from "./affect.ts";
import { buildWriteContext, contextBoost } from "./context.ts";
import { ensureAnchor, linkEventAnchor, reinforceEdge, bumpAnchorHits, type AnchorIndex } from "./anchors.ts";
import { addAlias } from "./anchors.ts";
import { proposeAnchors, bindableProposals, inferredProposals, mergeProposals, type AnchorProposal } from "./propose.ts";
import { dayKeyToTs, estimateTokens, fromJson, newId, splitSentences, truncate } from "./util.ts";
import { bigrams } from "./text.ts";
import { reindexEventFts } from "./db.ts";

/** 重新量一条事件的体积，并同步全文索引。压缩和强化都要用它。 */
export function resealOne(db: DatabaseSync, eventId: string, tier: Tier): void {
  const r = db
    .prepare("SELECT title, detail, cause, effect, core_fragment, affect_summary, key_facts FROM events WHERE id = ?")
    .get(eventId);
  if (!r) return;
  const size = measureEvent({
    tier,
    title: r.title as string,
    detail: r.detail as string | null,
    cause: r.cause as string | null,
    effect: r.effect as string | null,
    coreFragment: r.core_fragment as string | null,
    affectSummary: r.affect_summary as string | null,
    keyFacts: fromJson<string[]>(r.key_facts as string, []),
  });
  db.prepare("UPDATE events SET size_tokens = ? WHERE id = ?").run(size, eventId);
  reindexEventFts(db, eventId);
}

export interface TurnInput {
  day: string;
  role: "user" | "assistant";
  text: string;
  /** 谁说的（QQ 号）。共享记忆下靠它区分「他的事」和「别人的事」 */
  speakerId?: string;
}

/**
 * 落盘原始对话（L0 工作记忆）。睡眠任务只从这里取未处理的轮次。
 */
export function ingestTurns(db: DatabaseSync, turns: TurnInput[]): number {
  const now = Date.now();
  const maxSeqRow = db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM turns").get();
  let seq = Number(maxSeqRow?.s ?? 0);
  const stmt = db.prepare(
    "INSERT INTO turns(id, seq, day, ts, role, text, speaker_id, processed, created_at) VALUES(?,?,?,?,?,?,?,0,?)",
  );
  for (const t of turns) {
    seq += 1;
    stmt.run(newId("turn"), seq, t.day, dayKeyToTs(t.day), t.role, t.text, t.speakerId ?? "", now);
  }
  return turns.length;
}

/** 一句对话值不值得变成事件。阈值故意偏低，宁可多记，压缩交给睡眠。 */
const SENTENCE_KEEP_THRESHOLD = 1.2;

export function extractEvents(db: DatabaseSync, cfg: MemoryConfig, index: AnchorIndex): {
  events: number;
  turns: number;
  edges: number;
  anchors: number;
  deferredPins: number;
  reinforced: number;
} {
  const pending = db
    .prepare("SELECT id, day, ts, role, text FROM turns WHERE processed = 0 ORDER BY seq ASC")
    .all();
  if (pending.length === 0) return { events: 0, turns: 0, edges: 0, anchors: 0, deferredPins: 0, reinforced: 0 };

  let eventCount = 0;
  let edgeCount = 0;
  let deferredPins = 0;
  let reinforcedCount = 0;
  const touchedAnchors = new Set<string>();

  // 按天分批：跨天的「前因」不接续，符合人类「睡一觉就断片」的直觉
  const byDay = new Map<string, typeof pending>();
  for (const t of pending) {
    const day = String(t.day);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(t);
  }

  for (const [day, rows] of byDay) {
    // 锚点继承只在同一天内传递：睡一觉就断片，这符合人的直觉
    let recent: AnchorProposal[] = [];
    for (const row of rows) {
      if (String(row.role) !== "user") continue;
      // 「前因」只在同一个人的同一段话里接续，跨段拼出来的因果基本是错的
      let previousKept: { id: string; text: string } | null = null;
      const ts = Number(row.ts);
      const sentences = splitSentences(String(row.text));
      for (const sentence of sentences) {
        // 不找锚点，而是生成锚点提案：字面 / 别名 / 继承 / 指代 / 通名 / 共现
        const proposals = proposeAnchors({ db, index, text: sentence, recent });
        const grounded = proposals.filter((p) => p.source === "literal" || p.source === "alias");
        // 先检索处境，再读这句话：情绪很多时候不在句子里，在处境里
        const ctx = buildWriteContext(db, index, sentence, ts, proposals);
        const affect = analyzeAffect(sentence, ctx);
        const score =
          Math.min(2, grounded.length) * 2 +
          affect.arousal * 3 +
          (sentence.length >= 20 ? 0.5 : 0) +
          (/我|咱/.test(sentence) ? 0.4 : 0) +
          contextBoost(ctx, sentence);
        if (score < SENTENCE_KEEP_THRESHOLD) continue;

        const pinReason = cfg.pinPatterns.find((p) => sentence.includes(p)) ?? null;
        // 语境推断出的承诺不比字面命中可信：字面自动钉，推断只送待审
        const pinSuggestion =
          pinReason === null && ctx.kinds.includes("promise")
            ? `语境判断为承诺/约定（依据 ${ctx.sourceIds.length} 条旧记忆，待人确认）`
            : null;
        const cause = previousKept ? truncate(previousKept.text, 60) : null;

        // 同一件事又被提了一遍？不新建，把旧那条变强（重复强化）
        const dup = findReinforceTarget(db, sentence, ts);
        let id: string;
        if (dup) {
          reinforceExisting(db, dup, sentence, ts);
          id = dup.id;
          reinforcedCount += 1;
        } else {
          const event: Partial<EventRow> = {
            day,
            ts,
            tier: "detailed",
            stage: "extracted",
            title: truncate(sentence, 24),
            detail: sentence,
            cause,
            effect: null,
            coreFragment: affect.core,
            affect,
            pinned: pinReason !== null,
            keyFacts: extractKeyFacts(sentence),
            derivedFrom: ctx.sourceIds,
            contextKinds: ctx.kinds,
          };
          const inserted = insertEventRow(db, event, cfg, ts, String(row.id), pinReason, pinSuggestion);
          id = inserted.id;
          if (inserted.pinDeferred) deferredPins += 1;
          eventCount += 1;
        }

        // 事实绑定只认高置信提案（字面/别名）；推断出来的用弱权重挂上，
        // 能被想起来，但不假装它是事实。
        const bound = bindableProposals(proposals);
        for (const p of bound) {
          linkEventAnchor(db, id, p.anchorId, 1.0);
          bumpAnchorHits(db, p.anchorId, ts);
          touchedAnchors.add(p.anchorId);
        }
        for (const p of inferredProposals(proposals)) {
          if (!cfg.bindInferredAnchors) break;
          linkEventAnchor(db, id, p.anchorId, 0.35);
          touchedAnchors.add(p.anchorId);
        }
        // 同一事件里共同出现的锚点连边，这是联想的物理基础
        for (let i = 0; i < bound.length; i += 1) {
          for (let j = i + 1; j < bound.length; j += 1) {
            if (reinforceEdge(db, bound[i].anchorId, bound[j].anchorId, "co-occur", ts)) edgeCount += 1;
          }
        }
        previousKept = { id, text: sentence };
        recent = mergeProposals(proposals, recent);
      }
    }
    // 补齐 effect：同一天里下一条事件就是「后果」
    const dayEvents = db
      .prepare("SELECT id, title FROM events WHERE day = ? ORDER BY ts ASC, created_at ASC")
      .all(day);
    for (let i = 0; i < dayEvents.length - 1; i += 1) {
      db.prepare("UPDATE events SET effect = ? , updated_at = ? WHERE id = ? AND effect IS NULL")
        .run(truncate(String(dayEvents[i + 1].title), 40), Date.now(), String(dayEvents[i].id));
    }

    // 同一天出现的锚点彼此连边（弱边）：这是「升职那天我妈哭了」能被想起来的通路
    const dayAnchors = new Set<string>();
    for (const ev of dayEvents) {
      for (const link of db.prepare("SELECT anchor_id FROM event_anchors WHERE event_id = ?").all(String(ev.id))) {
        dayAnchors.add(String(link.anchor_id));
      }
    }
    const ids = [...dayAnchors];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        // 同一天出现但不同事件里的锚点，只算弱边：它们「那天一起出现过」而已
        if (reinforceEdge(db, ids[i], ids[j], "same-day", dayKeyToTs(day), 0.3, 0.3)) edgeCount += 1;
      }
    }

    // 情景记忆：没什么锚点的事件，人也会把它归到「那几天那件事」底下。
    // 不挂这一层，「病理结果是良性」这种没有实体名的句子会永远检索不到。
    for (const ev of dayEvents) {
      const own = db.prepare("SELECT anchor_id FROM event_anchors WHERE event_id = ?").all(String(ev.id));
      if (own.length >= 2) continue;
      const ownIds = new Set(own.map((o) => String(o.anchor_id)));
      let attached = 0;
      for (const anchorId of ids) {
        if (attached >= 6) break;
        if (ownIds.has(anchorId)) continue;
        linkEventAnchor(db, String(ev.id), anchorId, 0.5);
        attached += 1;
      }
    }
  }

  db.prepare("UPDATE turns SET processed = 1 WHERE processed = 0").run();
  resealAllEvents(db, cfg);

  return { events: eventCount, turns: pending.length, edges: edgeCount, anchors: touchedAnchors.size, deferredPins, reinforced: reinforcedCount };
}

interface InsertResult {
  id: string;
  pinDeferred: boolean;
}

/**
 * 钉住的三道闸都在这里：机械规则命中 → 查总量 → 查每日新增 → 给有效期。
 * 模型没有「这条很重要」的投票权，所以不存在被它说服而滥用的问题。
 */
export function insertEventRow(
  db: DatabaseSync,
  e: Partial<EventRow>,
  cfg: MemoryConfig,
  nowTs: number,
  sourceTurnId: string,
  pinReason: string | null,
  pinSuggestion: string | null = null,
): InsertResult {
  const id = newId("ev");
  const now = Date.now();
  const affect = e.affect!;

  let pinned = 0;
  let pinExpiresAt: number | null = null;
  let deferredReason: string | null = null;

  if (pinReason) {
    const totalPinned = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE pinned = 1").get()?.c ?? 0);
    const dayPinned = Number(
      db.prepare("SELECT COUNT(*) AS c FROM events WHERE pinned = 1 AND day = ?").get(e.day!)?.c ?? 0,
    );
    if (totalPinned >= cfg.pinnedLimit) {
      deferredReason = `钉住总数已达上限 ${cfg.pinnedLimit}，命中「${pinReason}」`;
    } else if (dayPinned >= cfg.pinnedDailyLimit) {
      deferredReason = `今日钉住已达上限 ${cfg.pinnedDailyLimit}，命中「${pinReason}」`;
    } else {
      pinned = 1;
      // 身份类事实（密码、生日）不设期限；承诺类（约好、答应）到期就松手
      pinExpiresAt = cfg.pinPermanentPatterns.includes(pinReason) ? null : nowTs + cfg.pinnedTtlDays * 86_400_000;
    }
  }

  db.prepare(
    `INSERT INTO events(id, day, ts, period_label, tier, stage, title, detail, cause, effect, core_fragment,
       affect_valence, affect_arousal, affect_tags, affect_summary, pinned, pin_expires_at,
       key_facts, strength, mentions,
       derived_from, context_kinds, size_tokens, archived,
       source_turn_id, created_at, updated_at, speaker_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, e.day!, e.ts!, null, e.tier!, e.stage!, e.title!, e.detail ?? null, e.cause ?? null, e.effect ?? null,
    e.coreFragment ?? null, affect.valence, affect.arousal, JSON.stringify(affect.tags), affect.summary,
    pinned, pinExpiresAt,
    JSON.stringify(e.keyFacts ?? []), e.strength ?? 1.0, e.mentions ?? 1,
    JSON.stringify(e.derivedFrom ?? []), JSON.stringify(e.contextKinds ?? []),
    0, 0, sourceTurnId, now, now, String(e.speakerId ?? ""),
  );
  reindexEventFts(db, id);

  if (deferredReason) {
    db.prepare("INSERT INTO pending_pins(id, event_id, reason, created_at, status) VALUES(?,?,?,?,'pending')").run(
      newId("pin"),
      id,
      deferredReason,
      now,
    );
  } else if (pinSuggestion) {
    // 语境推断出来的结论，一律不自动生效，进待审队列
    db.prepare("INSERT INTO pending_pins(id, event_id, reason, created_at, status) VALUES(?,?,?,?,'pending')").run(
      newId("pin"),
      id,
      pinSuggestion,
      now,
    );
  }

  return { id, pinDeferred: deferredReason !== null };
}

/**
 * 情景锚点补挂：一条事件如果自己的锚点很少，就挂上当天的其他锚点（弱权重）。
 *
 * 人回忆的时候是「那几天的事」一起想起来的。把「病理结果是良性」单独挂着「病理」，
 * 就永远接不上「我妈做手术」这条线——补挂当天锚点才能把同一天的事连成一段。
 */
export function attachDayAnchors(db: DatabaseSync, day: string): number {
  const dayEvents = db.prepare("SELECT id FROM events WHERE day = ?").all(day);
  if (dayEvents.length === 0) return 0;
  const pool = new Set<string>();
  for (const ev of dayEvents) {
    for (const l of db.prepare("SELECT anchor_id FROM event_anchors WHERE event_id = ?").all(String(ev.id))) {
      pool.add(String(l.anchor_id));
    }
  }
  const ids = [...pool];
  if (ids.length === 0) return 0;

  let attached = 0;
  for (const ev of dayEvents) {
    const own = db.prepare("SELECT anchor_id FROM event_anchors WHERE event_id = ?").all(String(ev.id));
    if (own.length >= 2) continue;
    const ownIds = new Set(own.map((o) => String(o.anchor_id)));
    let n = 0;
    for (const a of ids) {
      if (n >= 6) break;
      if (ownIds.has(a)) continue;
      linkEventAnchor(db, String(ev.id), a, 0.5);
      n += 1;
      attached += 1;
    }
  }
  return attached;
}

/** 约定有期限：过了日子就不该再占着「永不遗忘」的位置。 */
export function expirePins(db: DatabaseSync, nowTs: number): number {
  const res = db.prepare("UPDATE events SET pinned = 0, pin_expires_at = NULL WHERE pinned = 1 AND pin_expires_at IS NOT NULL AND pin_expires_at < ?").run(nowTs);
  return Number(res.changes ?? 0);
}

/** 事件体积口径：只算真正会进上下文/占存储的字段。 */
export function measureEvent(e: {
  tier: Tier;
  title: string | null;
  detail: string | null;
  cause: string | null;
  effect: string | null;
  coreFragment: string | null;
  affectSummary: string | null;
  keyFacts?: string[] | null;
}): number {
  // 关键事实在任何层都要保留，所以任何层都要计入
  const factsTokens = estimateTokens((e.keyFacts ?? []).join(""));
  if (e.tier === "detailed") {
    return (
      estimateTokens(e.title) +
      estimateTokens(e.detail) +
      estimateTokens(e.cause) +
      estimateTokens(e.effect) +
      estimateTokens(e.coreFragment) +
      estimateTokens(e.affectSummary) +
      factsTokens
    );
  }
  if (e.tier === "compressed") {
    return (
      estimateTokens(e.title) +
      estimateTokens(e.cause) +
      estimateTokens(e.effect) +
      estimateTokens(e.coreFragment) +
      estimateTokens(e.affectSummary) +
      factsTokens
    );
  }
  // fossil 也别把 title 漏掉：它确实还占着存储，只是不再算进上下文
  return estimateTokens(e.affectSummary) + estimateTokens(e.coreFragment) + estimateTokens(e.title) + factsTokens;
}

export function resealAllEvents(db: DatabaseSync, _cfg: MemoryConfig): void {
  const rows = db.prepare(
    "SELECT id, tier, title, detail, cause, effect, core_fragment, affect_summary, key_facts FROM events",
  ).all();
  const upd = db.prepare("UPDATE events SET size_tokens = ? WHERE id = ?");
  for (const r of rows) {
    const size = measureEvent({
      tier: String(r.tier) as Tier,
      title: r.title as string,
      detail: r.detail as string | null,
      cause: r.cause as string | null,
      effect: r.effect as string | null,
      coreFragment: r.core_fragment as string | null,
      affectSummary: r.affect_summary as string | null,
      keyFacts: fromJson<string[]>(r.key_facts as string, []),
    });
    upd.run(size, String(r.id));
  }
}

/** 强度上限：反复提起不能无限抗遗忘，否则老记忆会挤死新记忆 */
export const MAX_STRENGTH = 3.0;

/**
 * 关键事实的启发式提取：数字、金额、日期、期限。
 * 模型版由模型自己产出，这里只是让规则版也能沾点光。
 */
export function extractKeyFacts(text: string): string[] {
  const facts = new Set<string>();
  const UNIT = "块|元|万|千|百|岁|天|年|个月|次|点|小时|个|号";
  // 阿拉伯数字：1块、3天、2026年
  for (const m of text.matchAll(new RegExp(`\\d+(?:\\.\\d+)?\\s*(?:${UNIT})?`, "g"))) {
    const v = m[0].trim();
    if (v.length >= 2) facts.add(v);
  }
  // 中文数字必须带单位，否则「一个人」「一起」会被当成事实
  for (const m of text.matchAll(new RegExp(`[一二三四五六七八九十百千万两]+\\s*(?:${UNIT})`, "g"))) {
    facts.add(m[0].replace(/\s+/g, ""));
  }
  // 期限类
  for (const m of text.matchAll(/(?:下|这|上|明|今)(?:周|个?月|年)[一二三四五六日天]?|月底|年底|明年|今天/g)) {
    facts.add(m[0]);
  }
  for (const m of text.matchAll(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g)) facts.add(m[0].replace(/\s+/g, ""));
  return [...facts].slice(0, 8);
}

/** 提起 n 次对应的强度：1 次 = 1.0，2 次 ≈ 1.6，4 次 ≈ 2.2，之后收敛到 3 */
export function strengthFor(mentions: number): number {
  return Math.min(MAX_STRENGTH, 1 + 0.6 * Math.log2(Math.max(1, mentions)));
}

export interface ReinforceTarget {
  id: string;
  title: string;
  detail: string | null;
  similarity: number;
}

/**
 * 找「同一件事又被提了一遍」的那条既有记忆。
 *
 * 这是重复强化的入口：重复的内容不新建事件，而是把旧事件变强——
 * 越常被提起的越抗遗忘、越容易被想起来，这正是人脑的间隔重复效应。
 */
export function findReinforceTarget(db: DatabaseSync, text: string, ts: number): ReinforceTarget | null {
  const grams = bigrams(text);
  if (grams.size < 5) return null; // 太短的句子合并起来容易误伤
  const window = 90 * 86_400_000;
  const rows = db
    .prepare(
      "SELECT id, title, detail, core_fragment FROM events WHERE ts BETWEEN ? AND ? AND tier != 'fossil'",
    )
    .all(ts - window, ts + window);

  let best: ReinforceTarget | null = null;
  for (const r of rows) {
    const hay = bigrams(`${String(r.title)} ${String(r.detail ?? "")}`);
    if (hay.size === 0) continue;
    let inter = 0;
    for (const g of grams) if (hay.has(g)) inter += 1;
    const jaccard = inter / (grams.size + hay.size - inter);
    if (!best || jaccard > best.similarity) {
      best = { id: String(r.id), title: String(r.title), detail: (r.detail as string | null) ?? null, similarity: jaccard };
    }
  }
  return best && best.similarity >= 0.62 ? best : null;
}

/**
 * 强化一条既有记忆：次数 +1、强度上升、补进更完整的描述。
 * 层级不升（降级是单向的），但它在后续的降级队列里会排到后面。
 */
export function reinforceExisting(
  db: DatabaseSync,
  target: ReinforceTarget,
  newText: string,
  ts: number,
): { mentions: number; strength: number } {
  const row = db.prepare("SELECT mentions, detail FROM events WHERE id = ?").get(target.id);
  const mentions = Number(row?.mentions ?? 1) + 1;
  const strength = strengthFor(mentions);
  const oldDetail = String(row?.detail ?? "");
  // 更完整的描述才有价值；重复的短句不覆盖
  // 旧的「更完整才覆盖」有漏洞：新版带着〔我当时想：…〕，但字数没旧的多，
  // 就会被判成「不如旧的」直接丢掉——所以她永远看不到自己补进去的判断。
  // 规则：新的有「我当时想」而旧的没有 → 一律换成新的。
  const newHasView = newText.includes("〔我当时想：");
  const oldHasView = oldDetail.includes("〔我当时想：");
  const detail =
    (newHasView && !oldHasView) || [...newText].length > [...oldDetail].length ? newText : oldDetail;
  db.prepare("UPDATE events SET mentions = ?, strength = ?, detail = ?, updated_at = ? WHERE id = ?").run(
    mentions,
    strength,
    detail.length > 0 ? detail : null,
    ts,
    target.id,
  );
  resealOne(db, target.id, (db.prepare("SELECT tier FROM events WHERE id = ?").get(target.id)?.tier as Tier) ?? "detailed");
  return { mentions, strength };
}

export function ensureSeedAnchors(
  db: DatabaseSync,
  seeds: Array<{ name: string; kind: string; aliases?: string[] }>,
): number {
  const now = Date.now();
  let n = 0;
  for (const s of seeds) {
    const id = ensureAnchor(db, s.name, s.kind as never, now);
    for (const alias of s.aliases ?? []) addAlias(db, alias, id);
    n += 1;
  }
  return n;
}



