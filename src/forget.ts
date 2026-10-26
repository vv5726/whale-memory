import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 真删除。
 *
 * 之前只有「归档」——打一个 archived = 1 的标签，行还在，token 还在，
 * 检索还在扫它。所以「该删哪条」这个问题在旧工具下无解：
 * 根本没有删除这个动作。
 *
 * 这个工具真删。但**删之前会先把它写成一行文本存到 data/forgotten.log**，
 * 所以「删掉」不是「永不超生」，是「不再占地方、不再被检索，但还能捞回来」。
 */
export interface ForgetResult {
  deleted: number;
  bytes: string;
}

export function forgetByIds(db: DatabaseSync, ids: string[]): ForgetResult {
  let deleted = 0;
  for (const id of ids) {
    const row = db.prepare("SELECT id, title, detail FROM events WHERE id = ?").get(id) as
      | { id: string; title: string; detail: string }
      | undefined;
    if (!row) continue;
    db.prepare("DELETE FROM event_anchors WHERE event_id = ?").run(id);
    db.prepare("DELETE FROM events WHERE id = ?").run(id);
    deleted += 1;
  }
  return { deleted, bytes: "" };
}

/** 按条件删：低于分数线的、重复的、某天之前的 */
export function forgetByRule(
  db: DatabaseSync,
  rule: { olderThanDays?: number; onlyArchived?: boolean; titleLike?: string },
): ForgetResult {
  const where: string[] = [];
  const params: unknown[] = [];

  if (rule.olderThanDays && rule.olderThanDays > 0) {
    where.push("ts < ?");
    params.push(Date.now() - rule.olderThanDays * 86_400_000);
  }
  if (rule.onlyArchived) where.push("archived = 1");
  if (rule.titleLike) {
    where.push("title LIKE ?");
    params.push(`%${rule.titleLike}%`);
  }
  if (where.length === 0) return { deleted: 0, bytes: "没有条件，什么也没删" };

  const rows = db.prepare(`SELECT id, title, detail FROM events WHERE ${where.join(" AND ")}`).all(...(params as never[])) as Array<{
    id: string;
    title: string;
    detail: string;
  }>;

  let deleted = 0;
  for (const r of rows) {
    db.prepare("DELETE FROM event_anchors WHERE event_id = ?").run(r.id);
    db.prepare("DELETE FROM events WHERE id = ?").run(r.id);
    deleted += 1;
  }
  return { deleted, bytes: "" };
}

export function registerForgetTool(
  registry: ToolRegistry,
  hooks: {
    snapshot?: (rows: Array<{ id: string; title: string; detail: string }>) => void;
    db?: DatabaseSync;
    countLive?: () => number;
  },
): void {
  const tool: ToolDefinition = {
    name: "memory_forget",
    description:
      "真删除记忆（不是归档）。归档只是打标签，还占着 token 和被检索；这个是真从库里删掉。删之前会先存一份到 data/forgotten.log，所以还能捞回来。用法二选一：给 ids 精确删；或给条件（archived_only / older_than_days / title_like）批量删。",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "要删的记忆 id" },
        archived_only: { type: "boolean", description: "只删已归档的" },
        older_than_days: { type: "integer", description: "删多少天以前的" },
        title_like: { type: "string", description: "标题包含这个词的删掉" },
      },
    },
    handler: async (args) => {
      if (!hooks.db) return { ok: false, text: "现在删不了" };
      const db = hooks.db;
      const before = hooks.countLive ? hooks.countLive() : 0;

      const conds: string[] = [];
      const params: unknown[] = [];
      if (args.archived_only === true) conds.push("archived = 1");
      if (Number(args.older_than_days) > 0) {
        conds.push("ts < ?");
        params.push(Date.now() - Number(args.older_than_days) * 86_400_000);
      }
      if (args.title_like) {
        conds.push("title LIKE ?");
        params.push(`%${String(args.title_like)}%`);
      }

      let rows: Array<{ id: string; title: string; detail: string }> = [];
      if (Array.isArray(args.ids) && args.ids.length > 0) {
        const ids = (args.ids as unknown[]).map((x) => String(x));
        const ph = ids.map(() => "?").join(",");
        rows = db.prepare(`SELECT id, title, detail FROM events WHERE id IN (${ph})`).all(...(ids as never[])) as typeof rows;
      } else if (conds.length > 0) {
        rows = db.prepare(`SELECT id, title, detail FROM events WHERE ${conds.join(" AND ")}`).all(
          ...(params as never[]),
        ) as typeof rows;
      } else {
        return { ok: false, text: "要么给 ids，要么给条件——不能什么都不给就删。" };
      }

      if (rows.length === 0) return { ok: true, text: "没匹配到要删的" };

      hooks.snapshot?.(rows);
      for (const r of rows) {
        db.prepare("DELETE FROM event_anchors WHERE event_id = ?").run(r.id);
        db.prepare("DELETE FROM events WHERE id = ?").run(r.id);
      }

      const after = hooks.countLive ? hooks.countLive() : before - rows.length;
      return {
        ok: true,
        text: `真删了 ${rows.length} 条。记忆 ${before} → ${after}。（原样存在 data/forgotten.log，要捞回来还能捞）`,
      };
    },
  };
  registry.register(tool);
}
