import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

function toAnchorIds(db: DatabaseSync, who: string): string[] {
  const num = (who.match(/\d{5,}/) ?? [])[0] ?? "";
  const ids = new Set<string>();
  try {
    if (num) {
      for (const r of db.prepare("SELECT id FROM anchors WHERE external_id = ?").all(num) as Array<{ id: string }>) ids.add(r.id);
    }
    for (const r of db.prepare("SELECT id FROM anchors WHERE name = ?").all(who) as Array<{ id: string }>) ids.add(r.id);
    for (const r of db.prepare("SELECT anchor_id FROM people WHERE display_name = ? OR aliases LIKE ?").all(who, `%${who}%`) as Array<{ anchor_id: string }>) {
      if (r.anchor_id) ids.add(r.anchor_id);
    }
  } catch {
    /* ignore */
  }
  return [...ids];
}

export function registerImpressionTools(registry: ToolRegistry, hooks: { db: DatabaseSync }): void {
  registry.register({
    name: "impression_add",
    description:
      "给某个人加一条「我怎么看他」。同一个可以有很多条，不覆盖旧的；权重 0-1，越高越代表你现在的看法（默认 0.5）。睡眠时会按被引用次数和时间重算权重，检索只带权重最高的三条。",
    parameters: {
      type: "object",
      properties: {
        person: { type: "string", description: "名字或 QQ 号" },
        text: { type: "string", description: "一句印象，短一点（40 字内最好）" },
        weight: { type: "number", description: "0-1，默认 0.5" },
      },
      required: ["person", "text"],
    },
    handler: async (args) => {
      const who = String(args.person ?? "").trim();
      const text = String(args.text ?? "").trim().slice(0, 120);
      if (!who || !text) return { ok: false, text: "要写清给谁、写什么" };
      const ids = toAnchorIds(hooks.db, who);
      if (ids.length === 0) return { ok: false, text: `没找到「${who}」的锚点` };
      const w = Math.max(0, Math.min(1, Number(args.weight ?? 0.5)));
      const now = Date.now();
      const id = "imp_" + randomBytes(6).toString("hex");
      hooks.db
        .prepare("INSERT INTO impressions (id, anchor_id, text, weight, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, ids[0], text, w, now, now);
      return { ok: true, text: `记下一条对${who}的印象（${w.toFixed(2)}）：${text}` };
    },
  } satisfies ToolDefinition);

  registry.register({
    name: "impression_list",
    description: "看对某个人的所有印象（按权重排序）。不填人就列出最近改过的。",
    parameters: {
      type: "object",
      properties: { person: { type: "string", description: "名字或 QQ 号；不填=最近改过的" } },
    },
    handler: async (args) => {
      const who = String(args.person ?? "").trim();
      const ids = who ? toAnchorIds(hooks.db, who) : [];
      const rows =
        ids.length > 0
          ? (hooks.db
              .prepare(`SELECT i.id, i.text, i.weight, a.name FROM impressions i JOIN anchors a ON a.id = i.anchor_id
                        WHERE i.anchor_id IN (${ids.map(() => "?").join(",")}) ORDER BY i.weight DESC, i.updated_at DESC`)
              .all(...ids) as Array<{ id: string; text: string; weight: number; name: string }>)
          : (hooks.db
              .prepare("SELECT i.id, i.text, i.weight, a.name FROM impressions i JOIN anchors a ON a.id = i.anchor_id ORDER BY i.updated_at DESC LIMIT 15")
              .all() as Array<{ id: string; text: string; weight: number; name: string }>);
      if (rows.length === 0) return { ok: true, text: who ? `还没有对${who}的印象` : "还没有任何印象" };
      return { ok: true, text: rows.map((r) => `[${r.weight.toFixed(2)}] ${r.name}：${r.text}（${r.id}）`).join("\n") };
    },
  } satisfies ToolDefinition);

  registry.register({
    name: "impression_delete",
    description: "删掉一条印象（id 从 impression_list 拿）。人变了、看法不成立了就删。",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "印象 id（imp_ 开头）" } },
      required: ["id"],
    },
    handler: async (args) => {
      const id = String(args.id ?? "").trim();
      const r = hooks.db.prepare("DELETE FROM impressions WHERE id = ?").run(id);
      return Number(r.changes) > 0 ? { ok: true, text: "删掉了" } : { ok: false, text: `没找到 ${id}` };
    },
  } satisfies ToolDefinition);
}
