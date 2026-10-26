import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { listGroupMembers } from "../group-roster.ts";

/**
 * 群名册工具。
 *
 * 提示词里只放一行群情（人多时只给几个名字），要全部成员就靠这个工具：
 * 「这个群里还有谁」这类问题，不该靠猜。
 */
export function registerRosterTools(registry: ToolRegistry, hooks: { db: DatabaseSync }): void {
  const tool: ToolDefinition = {
    name: "group_members",
    description:
      "查一个群的成员名册（不只是说过话的人）。想知道「这个群都有谁」「群里那个人是谁」「一共几个人」就用它。要群号；不给就用最近同步过的群。",
    parameters: {
      type: "object",
      properties: {
        group: { type: "integer", description: "群号；不填就用最近同步的那个群" },
        onlyAdmins: { type: "boolean", description: "只看群主和管理员" },
      },
    },
    handler: async (args) => {
      const groups = hooks.db
        .prepare("SELECT group_id, COUNT(*) c, MAX(synced_at) t FROM group_members GROUP BY group_id ORDER BY t DESC")
        .all() as Array<{ group_id: string; c: number; t: number }>;
      if (groups.length === 0) {
        return { ok: false, text: "还没有任何群的名册（机器人启动后会自动同步一次）" };
      }

      const want = args.group === undefined || args.group === null ? "" : String(args.group).trim();
      const target = want.length > 0 ? want : groups[0]!.group_id;
      let rows = listGroupMembers(hooks.db, target);
      if (rows.length === 0) {
        return {
          ok: false,
          text: `群 ${target} 没有名册。有的群：${groups.map((g) => `${g.group_id}（${g.c} 人）`).join("、")}`,
        };
      }
      if (args.onlyAdmins === true) rows = rows.filter((r) => r.role === "owner" || r.role === "admin");

      const roleMark = (role: string): string => (role === "owner" ? "（群主）" : role === "admin" ? "（管理）" : "");
      const shown = rows.slice(0, 80);
      const lines = [
        `群 ${target} 共 ${rows.length} 人${args.onlyAdmins === true ? "（只列管理）" : ""}：`,
        ...shown.map((r) => `- ${r.name}${r.qqId !== r.name ? `（${r.qqId}）` : ""}${roleMark(r.role)}`),
      ];
      if (rows.length > shown.length) lines.push(`…还有 ${rows.length - shown.length} 人没列，问具体的人名我再查。`);
      return { ok: true, text: lines.join("\n") };
    },
  };
  registry.register(tool);
}
