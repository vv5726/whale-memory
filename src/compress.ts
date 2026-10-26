import type { DatabaseSync } from "node:sqlite";
import type { MemoryConfig, Tier } from "./types.ts";
import { coldAddress, reindexEventFts, tierTotals } from "./db.ts";
import { makeGist } from "./cold.ts";
import { measureEvent, resealOne } from "./extract.ts";
import { dayKey } from "./util.ts";

interface DbEvent {
  id: string;
  tier: Tier;
  ts?: number;
  day?: string;
  title: string;
  detail: string | null;
  cause: string | null;
  effect: string | null;
  core_fragment: string | null;
  affect_summary: string | null;
  pinned: number;
}

const MAX_ITERATIONS = 50_000;

/**
 * 预算驱动的单调降级。
 *
 * 为什么不用「按占比分层」直接算：压缩本身会改变体积，占比边界会跟着漂，
 * 于是每轮都在升降级之间震荡。改成「从最旧开始单向降级直到装得下」，
 * 每个事件只往旧的方向走一次，必然收敛。
 */
export function consolidateTiers(
  db: DatabaseSync,
  cfg: MemoryConfig,
  nowTs: number,
): { detailedToCompressed: number; compressedToFossil: number; archived: number; mergedFossils: number } {
  const detailedBudget = cfg.contextBudgetTokens * cfg.detailedQuota;
  const compressedBudget = cfg.contextBudgetTokens * cfg.compressedQuota;

  let d2c = 0;
  let c2f = 0;
  let archived = 0;

  const pickOldest = (tier: Tier): DbEvent | undefined =>
    db
      .prepare(
        "SELECT id, tier, title, detail, cause, effect, core_fragment, affect_summary, pinned FROM events WHERE tier = ? AND pinned = 0 ORDER BY strength ASC, ts ASC, created_at ASC LIMIT 1",
      )
      .get(tier) as DbEvent | undefined;

  let guard = 0;
  while (tierTotals(db).detailed.tokens > detailedBudget && guard < MAX_ITERATIONS) {
    const target = pickOldest("detailed");
    if (!target) break;
    archived += archiveBeforeForgetting(db, target, nowTs);
    demoteToCompressed(db, target, nowTs);
    d2c += 1;
    guard += 1;
  }

  while (guard < MAX_ITERATIONS) {
    const totals = tierTotals(db);
    const used = totals.detailed.tokens + totals.compressed.tokens;
    if (used <= detailedBudget + compressedBudget) break;
    const target = pickOldest("compressed") ?? pickOldest("detailed");
    if (!target) break;
    if (target.tier === "detailed") {
      archived += archiveBeforeForgetting(db, target, nowTs);
      demoteToCompressed(db, target, nowTs);
      d2c += 1;
      continue;
    }
    demoteToFossil(db, target, nowTs);
    c2f += 1;
    guard += 1;
  }

  // 化石层本来只保留「感受 + 一个片段」，可它仍会无限累积。
  // 真到装不下的时候，只能像人对童年那样把最旧的几段糊成一片。
  let merged = 0;
  let mergeGuard = 0;
  while (totalTokens(db) > cfg.contextBudgetTokens && mergeGuard < 5_000) {
    if (!mergeOldestFossils(db, nowTs)) break;
    merged += 1;
    mergeGuard += 1;
  }

  return { detailedToCompressed: d2c, compressedToFossil: c2f, archived, mergedFossils: merged };
}

export function totalTokens(db: DatabaseSync): number {
  const r = db.prepare("SELECT COALESCE(SUM(size_tokens),0) AS t FROM events").get();
  return Number(r?.t ?? 0);
}

/**
 * 把最旧的两条化石记忆合并成一条「那阵子」。
 * 保留 arousal 更高的那份感受和片段 —— 人类回忆遥远年代时留下的也正是情绪最重的那个画面。
 */
function mergeOldestFossils(db: DatabaseSync, nowTs: number): boolean {
  const rows = db
    .prepare(
      "SELECT id, ts, day, title, core_fragment, affect_summary, affect_valence, affect_arousal, affect_tags FROM events WHERE tier = 'fossil' AND pinned = 0 ORDER BY ts ASC, created_at ASC LIMIT 2",
    )
    .all();
  if (rows.length < 2) return false;

  const [a, b] = rows;
  const keep = Number(a.affect_arousal) >= Number(b.affect_arousal) ? a : b;
  const drop = keep === a ? b : a;
  const keepId = String(keep.id);
  const dropId = String(drop.id);

  db.prepare(
    "UPDATE events SET title = ?, ts = MIN(ts, ?), core_fragment = ?, affect_summary = ?, affect_arousal = ?, affect_valence = ?, updated_at = ? WHERE id = ?",
  ).run(
    `${keep.day} 前后`,
    Number(drop.ts),
    keep.core_fragment ?? keep.title,
    keep.affect_summary,
    Math.max(Number(a.affect_arousal), Number(b.affect_arousal)),
    (Number(a.affect_valence) + Number(b.affect_valence)) / 2,
    nowTs,
    keepId,
  );

  // 化石合并只保留「印象最深的那个片段」，所以也绝不继承被并掉那条的锚点。
  // 否则几次合并之后会攒出一个连着所有锚点的垃圾节点，什么话题都能把它勾出来。
  // 被并掉的那段只剩「底片」：不进检索、不占上下文，但关键词撞上了还能被唤醒
  const dropRaw = [drop.title, drop.core_fragment, drop.affect_summary]
    .filter((x): x is string => Boolean(x && String(x).length > 0))
    .join(" / ");
  if (dropRaw) {
    db.prepare(
      "INSERT OR IGNORE INTO cold_archive(event_id, address, gist, event_day, raw_detail, archived_at) VALUES(?,?,?,?,?,?)",
    ).run(
      dropId,
      coldAddress(dropId),
      makeGist(String(drop.title), String(drop.affect_summary ?? "")),
      String(drop.day),
      dropRaw,
      nowTs,
    );
  }
  db.prepare("DELETE FROM event_anchors WHERE event_id = ?").run(dropId);
  db.prepare("DELETE FROM events WHERE id = ?").run(dropId);
  db.prepare("DELETE FROM event_fts WHERE event_id = ?").run(dropId);

  // 合并后体积变小，重新量一次
  resealOne(db, keepId, "fossil");
  return true;
}

/**
 * L3 只剩感受 + 一个片段，前因后果要消失。
 *
 * 但「消失」只是从上下文里消失：原文在第一次被丢时进冷存储，留一个稳定地址。
 * 平时不读它（省 token），人和 AI 真需要时按地址取。
 */
function archiveBeforeForgetting(db: DatabaseSync, e: DbEvent, nowTs: number): number {
  const existing = db.prepare("SELECT 1 AS x FROM cold_archive WHERE event_id = ?").get(e.id);
  if (existing) return 0;
  const raw = [e.detail, e.cause, e.effect].filter((x): x is string => Boolean(x && x.length > 0)).join("\n");
  if (!raw) return 0;
  db.prepare(
    "INSERT INTO cold_archive(event_id, address, gist, event_day, tier_at_forget, raw_detail, archived_at) VALUES(?,?,?,?,?,?,?)",
  ).run(
    e.id,
    coldAddress(e.id),
    makeGist(e.title, e.affect_summary ?? ""),
    dayKey(e.ts ?? nowTs),
    e.tier,
    raw,
    nowTs,
  );
  return 1;
}

function demoteToCompressed(db: DatabaseSync, e: DbEvent, nowTs: number): void {
  db.prepare(
    "UPDATE events SET tier = 'compressed', stage = 'compressed', detail = NULL, updated_at = ? WHERE id = ?",
  ).run(nowTs, e.id);
  resealOne(db, e.id, "compressed");
}

function demoteToFossil(db: DatabaseSync, e: DbEvent, nowTs: number): void {
  db.prepare(
    "UPDATE events SET tier = 'fossil', stage = 'fossilized', detail = NULL, cause = NULL, effect = NULL, archived = 1, updated_at = ? WHERE id = ?",
  ).run(nowTs, e.id);
  resealOne(db, e.id, "fossil");
}


