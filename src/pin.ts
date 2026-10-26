import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 钉住。
 *
 * 排序是按相关性来的，但**相关性不等于重要性**。
 * 有些事检索排不上号，却是不想丢的——那种得她自己钉住。
 *
 * 钉住的效果：
 *   - 不参与分层下沉（不会被压成片段）
 *   - 检索时加权
 *   - 可以设过期时间，到期自动解除
 */
export function pinMemory(
  db: DatabaseSync,
  input: { id?: string; title?: string; pin: boolean; expireDays?: number },
): { ok: boolean; text: string; matched: number } {
  const { id, title, pin, expireDays } = input;

  let rows: Array<{ id: string; title: string }> = [];
  if (id) {
    rows = db.prepare("SELECT id, title FROM events WHERE id = ?").all(id) as typeof rows;
  } else if (title) {
    rows = db.prepare("SELECT id, title FROM events WHERE title LIKE ? AND archived = 0 LIMIT 20").all(
      `%${title}%`,
    ) as typeof rows;
  } else {
    return { ok: false, text: "要么给 id，要么给标题里的一段", matched: 0 };
  }

  if (rows.length === 0) return { ok: false, text: "没找到这条记忆", matched: 0 };
  if (rows.length > 1 && !id) {
    return {
      ok: false,
      text: `匹配到 ${rows.length} 条，说具体点：${rows.slice(0, 5).map((r) => r.title.slice(0, 20)).join("、")}`,
      matched: rows.length,
    };
  }

  const target = rows[0]!;
  const expiresAt = pin && expireDays && expireDays > 0 ? Date.now() + expireDays * 86_400_000 : null;

  db.prepare("UPDATE events SET pinned = ?, pin_expires_at = ? WHERE id = ?").run(
    pin ? 1 : 0,
    expiresAt,
    target.id,
  );

  return {
    ok: true,
    text: pin
      ? `钉住了：${target.title.slice(0, 30)}${expiresAt ? `（${expireDays} 天后自动解除）` : "（不会自动解除）"}`
      : `解开了：${target.title.slice(0, 30)}`,
    matched: 1,
  };
}

export function registerPinTool(
  registry: ToolRegistry,
  hooks: { pin?: (input: { id?: string; title?: string; pin: boolean; expireDays?: number }) => { ok: boolean; text: string } },
): void {
  const tool: ToolDefinition = {
    name: "memory_pin",
    description:
      "把一条记忆钉住/解开。钉住的不会被下沉压缩，检索时加权。排序是按相关性来的，但相关性不等于重要性——有些事排不上号却不想丢，那种你自己钉。可以给个天数，到期自动解除。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "标题里的一段（能唯一认出来就行）" },
        id: { type: "string", description: "或者直接给记忆 id" },
        pin: { type: "boolean", description: "true 钉住，false 解开" },
        expireDays: { type: "integer", description: "多少天后自动解除；不填就一直钉着" },
      },
      required: ["pin"],
    },
    handler: async (args) => {
      if (!hooks.pin) return { ok: false, text: "现在钉不了" };
      const r = hooks.pin({
        id: args.id ? String(args.id) : undefined,
        title: args.title ? String(args.title) : undefined,
        pin: args.pin === true,
        expireDays: args.expireDays === undefined ? undefined : Number(args.expireDays),
      });
      return { ok: r.ok, text: r.text };
    },
  };
  registry.register(tool);
}
