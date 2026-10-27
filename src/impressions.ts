import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 印象权重重算。
 *
 * 规则（每晚跑一次）：
 *   weight = clamp(0.55×旧权重 + 0.30×被印证程度 + 0.15×新鲜度, 0.05, 1)
 *   被印证程度 = 近 30 天被命中次数 / 最大命中次数（没被命中就往下走）
 *   新鲜度     = 1 - 距上次更新天数/30（越老越淡）
 * 命中：检索带出这条印象时 hits+1、last_hit_at=now（在 person-graph 里做）。
 */
export function recomputeImpressionWeights(db: DatabaseSync, now = Date.now()): Array<{ text: string; before: number; after: number }> {
  const rows = db
    .prepare("SELECT id, text, weight, hits, last_hit_at, updated_at FROM impressions")
    .all() as Array<{ id: string; text: string; weight: number; hits: number; last_hit_at: number | null; updated_at: number }>;
  if (rows.length === 0) return [];
  const DAY = 86_400_000;
  const maxHits = Math.max(1, ...rows.map((r) => r.hits));
  const changed: Array<{ text: string; before: number; after: number }> = [];
  for (const r of rows) {
    const hitScore = Math.min(1, r.hits / maxHits);
    const ageDays = Math.max(0, (now - (r.last_hit_at ?? r.updated_at)) / DAY);
    const fresh = Math.max(0, Math.min(1, 1 - ageDays / 30));
    const next = Math.max(0.05, Math.min(1, 0.55 * r.weight + 0.3 * hitScore + 0.15 * fresh));
    if (Math.abs(next - r.weight) > 0.005) {
      db.prepare("UPDATE impressions SET weight = ?, updated_at = ? WHERE id = ?").run(next, now, r.id);
      changed.push({ text: r.text, before: r.weight, after: next });
    }
  }
  // 每次重算后命中数减半：避免老印象靠历史命中永远压着新印象
  db.prepare("UPDATE impressions SET hits = CAST(hits / 2 AS INTEGER)").run();
  return changed;
}

export function registerImpressionWeightTool(registry: ToolRegistry, hooks: { db: DatabaseSync }): void {
  registry.register({
    name: "impression_reweight",
    description:
      "现在重算一遍所有印象的权重（平时每晚自动跑一次）。规则：0.55×旧权重 + 0.30×近 30 天被印证程度 + 0.15×新鲜度；算完命中数减半，防止老印象永远压着新的。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const changed = recomputeImpressionWeights(hooks.db);
      if (changed.length === 0) return { ok: true, text: "重算完了，权重没有明显变化。" };
      const top = changed
        .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
        .slice(0, 8)
        .map((c) => `「${c.text.slice(0, 24)}」${c.before.toFixed(2)} → ${c.after.toFixed(2)}`);
      return { ok: true, text: `重算了 ${changed.length} 条：\n` + top.join("\n") };
    },
  } satisfies ToolDefinition);
}
