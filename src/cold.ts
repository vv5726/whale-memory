import type { DatabaseSync } from "node:sqlite";
import type { ColdHint, DerefResult } from "./types.ts";
import { coldAddress } from "./db.ts";
import { bigrams } from "./text.ts";
import { truncate } from "./util.ts";

/**
 * 冷存储 = 外部地址。
 *
 * 平时只留一行地址和一句摘要（几十个 token），正文躺在这里不参与检索、不进上下文。
 * 只有当人（或 AI）明确说「把 cold://xxx 打开看看」时才真正读出来。
 */
export function makeGist(title: string, summary: string): string {
  return truncate(summary ? `${title}｜${summary}` : title, 60);
}

export function dereference(db: DatabaseSync, input: string): DerefResult | null {
  const address = normalizeAddress(input);
  const row = db.prepare("SELECT event_id, address, gist, raw_detail, archived_at FROM cold_archive WHERE address = ? OR event_id = ?").get(address, address.replace(/^cold:\/\//, ""));
  if (!row) return null;
  const eventId = String(row.event_id);
  const live = db.prepare("SELECT tier FROM events WHERE id = ?").get(eventId);
  return {
    address: String(row.address ?? coldAddress(eventId)),
    eventId,
    gist: String(row.gist ?? ""),
    rawDetail: String(row.raw_detail),
    archivedAt: Number(row.archived_at),
    liveTier: live ? (String(live.tier) as DerefResult["liveTier"]) : null,
  };
}

export function normalizeAddress(input: string): string {
  const raw = input.trim();
  if (raw.startsWith("cold://")) return raw;
  if (raw === "") return raw;
  return coldAddress(raw);
}

/**
 * 找一个「地址提示」：只返回地址和一句话，绝不带正文。
 * 这是省 token 的关键——想起「有那么件事」很便宜，想起「那件事的细节」才贵。
 */
export function coldHints(db: DatabaseSync, query: string, limit = 2): ColdHint[] {
  const grams = bigrams(query);
  if (grams.size === 0) return [];

  const scored: Array<ColdHint & { score: number }> = [];
  for (const row of db.prepare("SELECT event_id, address, gist, raw_detail FROM cold_archive").all()) {
    const hay = `${row.gist ?? ""} ${row.raw_detail ?? ""}`;
    const hayGrams = bigrams(hay);
    const matched: string[] = [];
    for (const g of grams) if (hayGrams.has(g)) matched.push(g);
    if (matched.length === 0) continue;
    const score = matched.length / Math.max(1, grams.size);
    if (score < 0.2) continue;
    scored.push({
      address: String(row.address ?? coldAddress(String(row.event_id))),
      gist: String(row.gist ?? ""),
      matchedKeywords: matched,
      eventId: String(row.event_id),
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ score: _score, ...hint }) => hint);
}

export function coldCount(db: DatabaseSync): number {
  return Number(db.prepare("SELECT COUNT(*) AS c FROM cold_archive").get()?.c ?? 0);
}
