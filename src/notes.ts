import type { DatabaseSync } from "node:sqlite";
import { analyzeAffect } from "./affect.ts";
import { classify } from "./classify.ts";
import { reindexEventFts } from "./db.ts";
import { dayKey, estimateTokens, newId, periodLabel } from "./util.ts";

/**
 * 把「它自己记下的一条」直接写进记忆。
 *
 * 为什么不走 LLM 抽取：抽取器只认「人生事件」，会把「看了个视频的感想」
 * 当成噪音丢掉。但这条恰恰是它自己想记住的东西——
 * 让抽取器判断「这值不值得记」，等于把它的记忆交给一个不认识它的分类器。
 *
 * 所以这里直接落库：标题取第一句，正文原样保留，情绪用词典算，锚点留给后面的睡眠去挂。
 */
export function recordOwnNote(
  db: DatabaseSync,
  text: string,
  nowTs: number,
  sourceTurnId: string | null = null,
): { id: string; title: string } {
  const clean = text.replace(/\s+/g, " ").trim();

  // 同一件事又说了一遍 → 加强，不新建
  try {
    const day = dayKey(nowTs);
    const dup = findSimilar(db, clean, day);
    if (dup) {
      const mentions = dup.mentions + 1;
      const strength = Math.min(3, 1 + (mentions - 1) * 0.25);
      db.prepare("UPDATE events SET mentions = ?, strength = ?, updated_at = ? WHERE id = ?").run(
        mentions,
        strength,
        nowTs,
        dup.id,
      );
      const row = db.prepare("SELECT title FROM events WHERE id = ?").get(dup.id) as { title: string } | undefined;
      return { id: dup.id, title: String(row?.title ?? clean.slice(0, 24)) };
    }
  } catch {
    // 查重失败就照旧插入
  }
  const firstSentence = clean.split(/[。！？；\n]/)[0] ?? clean;
  const title = (firstSentence.length > 0 ? firstSentence : clean).slice(0, 24);

  const affect = analyzeAffect(clean);
  const id = newId("ev");
  const day = dayKey(nowTs);

  db.prepare(
    `INSERT INTO events (
      id, day, ts, period_label, tier, stage, title, detail, cause, effect, core_fragment,
      affect_valence, affect_arousal, affect_tags, affect_summary,
      pinned, pin_expires_at, key_facts, strength, mentions, derived_from, context_kinds, kind,
      size_tokens, archived, source_turn_id, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    day,
    nowTs,
    periodLabel(nowTs),
    "detailed",
    "detailed",
    title,
    clean,
    null,
    null,
    null,
    affect.valence,
    affect.arousal,
    JSON.stringify(affect.tags),
    affect.summary,
    0,
    null,
    JSON.stringify([]),
    1,
    1,
    JSON.stringify([]),
    JSON.stringify(["own-note"]), classify(`${title} ${clean}`),
    estimateTokens(clean),
    0,
    sourceTurnId,
    Date.now(),
    Date.now(),
  );

  try {
    reindexEventFts(db, id);
  } catch {
    // FTS 索引失败不影响这条记忆本身
  }

  return { id, title };
}

/**
 * 把一次走神记进记忆。
 *
 * 之前走神只写 journal 和 thoughts.json——那两份它自己读不到，
 * 所以「想过什么」等于每次想完就丢。现在过程也进记忆库，
 * 用 context_kinds 标记成 thought，方便以后单独对待（下沉/清洗时可以只针对它们）。
 */
export function recordThought(
  db: DatabaseSync,
  input: { anchor: string; related: string[]; goal: string; channel: string; message?: string },
  nowTs: number,
): { id: string; title: string } {
  const where =
    input.related.length > 0 ? `想到「${input.anchor}」，顺着还想到${input.related.join("、")}` : `想到「${input.anchor}」`;
  const path =
    input.channel === "chat"
      ? "决定找他说话"
      : input.channel === "content"
        ? "决定去看看内容"
        : input.channel === "act"
          ? "决定动手做"
          : "想了想，算了";

  const text = `${where}。目的：${input.goal || "（没写）"}。${path}${input.message ? `：${input.message}` : ""}`;

  const clean = text.replace(/\s+/g, " ").trim();

  // 同一件事又说了一遍 → 加强，不新建
  try {
    const day = dayKey(nowTs);
    const dup = findSimilar(db, clean, day);
    if (dup) {
      const mentions = dup.mentions + 1;
      const strength = Math.min(3, 1 + (mentions - 1) * 0.25);
      db.prepare("UPDATE events SET mentions = ?, strength = ?, updated_at = ? WHERE id = ?").run(
        mentions,
        strength,
        nowTs,
        dup.id,
      );
      const row = db.prepare("SELECT title FROM events WHERE id = ?").get(dup.id) as { title: string } | undefined;
      return { id: dup.id, title: String(row?.title ?? clean.slice(0, 24)) };
    }
  } catch {
    // 查重失败就照旧插入
  }
  const title = `走神：${input.anchor} → ${(input.goal || "没想清楚").slice(0, 20)}`;

  const affect = analyzeAffect(clean);
  const id = newId("ev");
  const day = dayKey(nowTs);

  db.prepare(
    `INSERT INTO events (
      id, day, ts, period_label, tier, stage, title, detail, cause, effect, core_fragment,
      affect_valence, affect_arousal, affect_tags, affect_summary,
      pinned, pin_expires_at, key_facts, strength, mentions, derived_from, context_kinds, kind,
      size_tokens, archived, source_turn_id, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    day,
    nowTs,
    "深夜",
    "detailed",
    0,
    title.slice(0, 60),
    clean,
    null,
    null,
    null,
    affect.valence,
    affect.arousal,
    JSON.stringify(affect.tags ?? []),
    affect.summary ?? null,
    0,
    null,
    "[]",
    1,
    1,
    "[]",
    JSON.stringify(["thought"]), classify(`${title} ${clean}`),
    Math.ceil(clean.length / 2),
    0,
    null,
    nowTs,
    nowTs,
  );

  try {
    reindexEventFts(db, id);
  } catch {
    // FTS 重建失败不影响写入
  }

  return { id, title };
}

/**
 * 找一条「说的其实是同一件事」的记忆。
 *
 * 为什么要有：memory_save 一直在无条件插入，
 * 同一件事说三遍就是三条独立记忆，强度全是 1——
 * 所以「越常提起越牢」这个机制从来没生效过。
 */
export function findSimilar(
  db: DatabaseSync,
  text: string,
  day: string,
): { id: string; mentions: number; strength: number } | null {
  const clean = String(text ?? "").replace(/\s+/g, "");
  if (clean.length < 6) return null;

  const rows = db
    .prepare("SELECT id, title, detail, mentions, strength FROM events WHERE day = ? AND archived = 0")
    .all(day) as Array<{ id: string; title: string; detail: string; mentions: number; strength: number }>;

  const grams = (t: string): Set<string> => {
    const s2 = String(t ?? "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
    const out = new Set<string>();
    for (let i = 0; i + 3 <= s2.length; i += 1) out.add(s2.slice(i, i + 3));
    return out;
  };

  const mine = grams(clean);
  if (mine.size === 0) return null;

  let best: { id: string; mentions: number; strength: number; score: number } | null = null;
  for (const r of rows) {
    const theirs = grams(r.detail);
    if (theirs.size === 0) continue;
    let hit = 0;
    for (const g of mine) if (theirs.has(g)) hit += 1;
    const score = hit / mine.size;
    if (score >= 0.6 && (!best || score > best.score)) {
      best = { id: r.id, mentions: Number(r.mentions ?? 1), strength: Number(r.strength ?? 1), score };
    }
  }
  return best ? { id: best.id, mentions: best.mentions, strength: best.strength } : null;
}
