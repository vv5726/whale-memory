import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 取舍由她自己定。
 *
 * 不是「每组留 3 条」——那是拍死的。
 * 改成：**按得分，过了线的都留**，线上的不管几条。
 * 分数线也能她自己调：调高了留得少、调低了留得多，代价是检索时可选的东西变多或变少。
 */

export interface SettleResult {
  kept: number;
  archived: number;
  threshold: number;
  dropped: Array<{ title: string; score: number }>;
}

function scoreOf(row: { key_facts: string; detail: string; title: string }): number {
  let kf = 0;
  try {
    kf = (JSON.parse(row.key_facts || "[]") as string[]).length;
  } catch {
    kf = 0;
  }
  let s = kf * 2 + Math.min(30, String(row.detail).length) / 10;
  if (/\d/.test(row.detail)) s += 1.5;
  if (String(row.title).length <= 30) s += 0.5;
  return s;
}

/**
 * 按分数线取舍。
 *
 * 只在「同一组」（共享同一个锚点）内部比——跨组比没意义，
 * 有的组天生就比别的组具体。
 */
export function settleByScore(db: DatabaseSync, threshold = 6): SettleResult {
  const rows = db
    .prepare("SELECT id, title, detail, key_facts FROM events WHERE archived = 0")
    .all() as Array<{ id: string; title: string; detail: string; key_facts: string }>;

  // 归组：用每条最"独家"的锚点
  const groups = new Map<string, Array<{ id: string; title: string; score: number }>>();
  for (const r of rows) {
    const anchors = db.prepare("SELECT anchor_id FROM event_anchors WHERE event_id = ?").all(r.id) as Array<{ anchor_id: string }>;
    let key = "__nogroup";
    let best = Number.MAX_SAFE_INTEGER;
    for (const a of anchors) {
      const c = Number(db.prepare("SELECT COUNT(*) AS c FROM event_anchors WHERE anchor_id = ?").get(a.anchor_id)?.c ?? 0);
      if (c < best) {
        best = c;
        key = a.anchor_id;
      }
    }
    const list = groups.get(key) ?? [];
    list.push({ id: r.id, title: r.title, score: Number(scoreOf(r).toFixed(1)) });
    groups.set(key, list);
  }

  const dropped: Array<{ title: string; score: number }> = [];
  let kept = 0;
  let archived = 0;

  for (const list of groups.values()) {
    // 每组至少留一条最好的——哪怕全组都低分，也不能整组消失
    const sorted = [...list].sort((a, b) => b.score - a.score);
    const keepIds = new Set<string>();
    sorted.forEach((item, i) => {
      if (i === 0 || item.score >= threshold) keepIds.add(item.id);
    });

    for (const item of sorted) {
      if (keepIds.has(item.id)) {
        kept += 1;
        db.prepare("UPDATE events SET verdict = 'keep', verdict_reason = '' WHERE id = ?").run(item.id);
        continue;
      }
      archived += 1;
      dropped.push({ title: item.title.slice(0, 40), score: item.score });
      db.prepare("UPDATE events SET archived = 1, verdict = 'demote', verdict_reason = ? WHERE id = ?").run(
        `得分 ${item.score}，低于线 ${threshold}`,
        item.id,
      );
    }
  }

  return { kept, archived, threshold, dropped: dropped.slice(0, 10) };
}

/** 注册成一个工具，交给她自己用 */
export function registerSettleTool(
  registry: ToolRegistry,
  hooks: { settle?: (threshold: number) => SettleResult },
): void {
  const tool: ToolDefinition = {
    name: "memory_settle",
    description:
      "给记忆做一次取舍：同一组里按信息量排序，过线的都留下，没过的归档（不删）。分数线你自己定——调高了留得少，调低了留得多。",
    parameters: {
      type: "object",
      properties: {
        threshold: { type: "number", description: "分数线，默认 6。越高越严格，建议 4-10 之间" },
      },
    },
    handler: async (args) => {
      if (!hooks.settle) return { ok: false, text: "现在做不了取舍" };
      const threshold = Math.max(1, Math.min(30, Number(args.threshold) || 6));
      const r = hooks.settle(threshold);
      const sample = r.dropped.length > 0 ? `\n被归档的（前几条）：${r.dropped.map((d) => `${d.title}(${d.score})`).join("、")}` : "";
      return {
        ok: true,
        text: `取舍完成（线 ${r.threshold}）：留 ${r.kept} 条，归档 ${r.archived} 条。${sample}`,
      };
    },
  };
  registry.register(tool);
}
