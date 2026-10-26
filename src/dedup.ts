import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 去重压缩。
 *
 * 重抽之后同一件事会有好几个版本：这个说「对方 要加工具」，那个说「对方 答应加个工具」。
 * 它们都算「同一件事」，但检索时互相稀释——捞十次出来十条半截话。
 *
 * 规则：同一天、标题高度相似的，只留一条，其余归档（不删，能恢复）。
 * 留哪条：有「我当时想」的优先 > 关键事实多的 > 正文更长的。
 */
export interface DedupResult {
  groups: number;
  merged: number;
  kept: number;
  dryRun: boolean;
}

function sigOf(title: string): string {
  // 标题的 2 字组集合，用来算相似度
  const t = String(title ?? "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
  const set = new Set<string>();
  for (let i = 0; i + 2 <= t.length; i += 1) set.add(t.slice(i, i + 2));
  return [...set].join("|");
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit += 1;
  return hit / Math.min(a.size, b.size);
}

export function dedupMemories(db: DatabaseSync, opts: { day?: string; dryRun?: boolean; threshold?: number } = {}): DedupResult {
  const threshold = Math.min(0.95, Math.max(0.5, opts.threshold ?? 0.7));
  const day = opts.day;
  const dryRun = opts.dryRun === true;

  const where = ["archived = 0"];
  const params: unknown[] = [];
  if (day) {
    where.push("day = ?");
    params.push(day);
  }

  const rows = db
    .prepare(`SELECT id, day, title, detail, key_facts, pinned FROM events WHERE ${where.join(" AND ")} ORDER BY day, ts`)
    .all(...(params as never[])) as Array<{
    id: string;
    day: string;
    title: string;
    detail: string;
    key_facts: string;
    pinned: number;
  }>;

  // 分数：有判断 > 关键事实多 > 正文长 > 钉住
  const score = (r: { detail: string; key_facts: string; pinned: number }): number => {
    let s = 0;
    if (String(r.detail).includes("〔我当时想：")) s += 100;
    if (Number(r.pinned) === 1) s += 50;
    try {
      s += ((JSON.parse(r.key_facts || "[]") as string[]) ?? []).length * 5;
    } catch {
      /* 忽略 */
    }
    s += Math.min(60, String(r.detail).length) / 2;
    return s;
  };

  const byDay = new Map<string, Array<{ id: string; title: string; detail: string; key_facts: string; pinned: number; grams: Set<string>; score: number }>>();
  for (const r of rows) {
    const grams = new Set(sigOf(r.title).split("|").filter(Boolean));
    const list = byDay.get(r.day) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      detail: r.detail,
      key_facts: r.key_facts,
      pinned: r.pinned,
      grams,
      score: score(r),
    });
    byDay.set(r.day, list);
  }

  let groups = 0;
  let merged = 0;
  let kept = 0;

  for (const list of byDay.values()) {
    const used = new Set<string>();
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]!;
      if (used.has(a.id)) continue;
      const cluster = [a];
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j]!;
        if (used.has(b.id)) continue;
        if (similarity(a.grams, b.grams) >= threshold) {
          cluster.push(b);
          used.add(b.id);
        }
      }
      if (cluster.length <= 1) {
        kept += 1;
        continue;
      }
      groups += 1;
      cluster.sort((x, y) => y.score - x.score);
      const winner = cluster[0]!;
      kept += 1;
      for (const loser of cluster.slice(1)) {
        merged += 1;
        if (!dryRun) {
          db.prepare("UPDATE events SET archived = 1, verdict = ?, verdict_reason = ? WHERE id = ?").run(
            "duplicate",
            `与「${winner.title.slice(0, 20)}」是同一件事，已归档`,
            loser.id,
          );
        }
      }
    }
  }

  return { groups, merged, kept, dryRun };
}

export function registerDedupTool(
  registry: ToolRegistry,
  hooks: { dedup?: (opts: { day?: string; dryRun?: boolean; threshold?: number }) => DedupResult },
): void {
  const tool: ToolDefinition = {
    name: "memory_dedup",
    description:
      "去重压缩：同一天里标题高度相似的记忆，只留一条，其余归档（不删，能恢复）。留哪条：有「我当时想」的优先，其次关键事实多的、正文长的、钉住的。重抽之后同一件事会有好几个版本，用这个收拾干净。先用 dryRun 预览再真做。",
    parameters: {
      type: "object",
      properties: {
        day: { type: "string", description: "只处理某一天（YYYY-MM-DD），不填就全部" },
        dryRun: { type: "boolean", description: "true = 只看会合并多少，不动数据" },
        threshold: { type: "number", description: "相似度门槛 0.5-0.95，默认 0.7。越低合并越狠" },
      },
    },
    handler: async (args) => {
      if (!hooks.dedup) return { ok: false, text: "现在做不了" };
      const r = hooks.dedup({
        day: args.day ? String(args.day) : undefined,
        dryRun: args.dryRun === true,
        threshold: args.threshold === undefined ? undefined : Number(args.threshold),
      });
      if (r.merged === 0) return { ok: true, text: "没有需要合并的重复。" };
      return {
        ok: true,
        text: r.dryRun
          ? `预览：${r.groups} 组重复，会归档 ${r.merged} 条，保留 ${r.kept} 条。确认就再调一次不带 dryRun。`
          : `去重完成：${r.groups} 组重复，归档 ${r.merged} 条，保留 ${r.kept} 条。`,
      };
    },
  };
  registry.register(tool);
}
