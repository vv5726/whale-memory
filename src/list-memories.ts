import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 枚举，不是检索。
 *
 * 检索是「按问题挑最相关的几条」——天生只给五条，多了是噪音。
 * 枚举是「把库里的列出来」——想知道自己一共记住了什么，得用这个。
 *
 * 两者混用会出岔子：问「我整理了多少条」，用检索答，只能答出五条。
 */
export interface ListRow {
  id: string;
  title: string;
  detail: string;
  kind: string;
  tier: string;
  day: string;
  pinned: boolean;
}

export function listMemories(
  db: DatabaseSync,
  opts: { limit?: number; kind?: string; sinceDays?: number; speakerId?: string } = {},
): { rows: ListRow[]; total: number } {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
  const where: string[] = ["archived = 0"];
  const params: unknown[] = [];

  if (opts.kind) {
    where.push("kind = ?");
    params.push(opts.kind);
  }
  if (opts.speakerId) {
    where.push("speaker_id = ?");
    params.push(opts.speakerId);
  }
  if (opts.sinceDays && opts.sinceDays > 0) {
    where.push("ts >= ?");
    params.push(Date.now() - opts.sinceDays * 86_400_000);
  }

  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS c FROM events WHERE ${where.join(" AND ")}`).get(...(params as never[])) as {
      c?: number;
    } | undefined)?.c ?? 0,
  );

  const rows = db
    .prepare(
      `SELECT id, title, detail, kind, tier, day, pinned FROM events
       WHERE ${where.join(" AND ")}
       ORDER BY ts DESC LIMIT ?`,
    )
    .all(...(params as never[]), limit) as Array<{
    id: string;
    title: string;
    detail: string;
    kind: string;
    tier: string;
    day: string;
    pinned: number;
  }>;

  return {
    rows: rows.map((r) => ({
      id: r.id,
      title: String(r.title ?? ""),
      detail: String(r.detail ?? ""),
      kind: String(r.kind ?? "event"),
      tier: String(r.tier ?? "detailed"),
      day: String(r.day ?? ""),
      pinned: Number(r.pinned) === 1,
    })),
    total,
  };
}

export function registerListTool(
  registry: ToolRegistry,
  hooks: { listMemories?: (opts: { limit?: number; kind?: string; sinceDays?: number }) => { rows: ListRow[]; total: number } },
): void {
  const tool: ToolDefinition = {
    name: "memory_list",
    description:
      "把记忆列出来（不是检索，是按时间倒序列清单）。想知道「我一共记住什么了」「昨天记了哪些」，用它。可以按类型、按最近几天筛。只给标题和 id，正文要用 memory_recall 或看具体那条。",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "列几条，默认 20，最多 100" },
        kind: { type: "string", description: "只看某类：user/feedback/project/reference/event" },
        sinceDays: { type: "integer", description: "只看最近几天" },
      },
    },
    handler: async (args) => {
      if (!hooks.listMemories) return { ok: false, text: "现在列不了" };
      const r = hooks.listMemories({
        limit: args.limit === undefined ? 20 : Number(args.limit),
        kind: args.kind ? String(args.kind) : undefined,
        sinceDays: args.sinceDays === undefined ? undefined : Number(args.sinceDays),
      });
      if (r.rows.length === 0) return { ok: true, text: "没有符合条件的记忆" };

      const lines = r.rows.map(
        (x, i) => { const v = x.detail.includes("〔我当时想：") ? "  〔有判断〕" : ""; return `${i + 1}. [${x.day}]${x.pinned ? "📌" : ""}${x.title.slice(0, 34)}（${x.kind}）${v}`; },
      );
      const head = `共 ${r.total} 条，列了 ${r.rows.length} 条：`;
      return { ok: true, text: [head, ...lines].join("\n") };
    },
  };
  registry.register(tool);
}
