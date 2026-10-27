import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { listGroupMembers } from "../group-roster.ts";

/**
 * 群名册工具。
 *
 * 名册是「学一次就够」的东西：第一次由机器人启动时拉一份存进库，
 * 之后这里只读库；真要更新（有人进群/退群）它自己可以 action=sync 拉一次。
 *
 * 为什么不做后台定时同步：那会让日志每半小时刷几行「名册 5 人」，
 * 而这些信息除非有人问，根本不需要。
 */
export function registerRosterTools(
  registry: ToolRegistry,
  hooks: { db: DatabaseSync; refresh?: (groupId: number) => Promise<number | null> },
): void {
  const tool: ToolDefinition = {
    name: "group_members",
    description:
      "查群的成员名册（不只是说过话的人）。想知道「这个群都有谁」「一共几个人」就用它。名册是第一次启动时学的；要最新的（有人退群/进群）传 action=sync 现拉一次。",
    parameters: {
      type: "object",
      properties: {
        group: { type: "integer", description: "群号；不填就用已有名册的那个群" },
        onlyAdmins: { type: "boolean", description: "只看群主和管理员" },
        action: { type: "string", enum: ["list", "sync"], description: "list=读已有（默认），sync=现在重新拉一次" },
      },
    },
    handler: async (args) => {
      const groups = hooks.db
        .prepare("SELECT group_id, COUNT(*) c, MAX(synced_at) t FROM group_members GROUP BY group_id ORDER BY t DESC")
        .all() as Array<{ group_id: string; c: number; t: number }>;

      const want = args.group === undefined || args.group === null ? "" : String(args.group).trim();
      const target = want.length > 0 ? want : groups[0]?.group_id ?? "";

      if (args.action === "sync") {
        if (!target) return { ok: false, text: "要刷新哪个群？给我群号。" };
        const gid = Number(target);
        if (!Number.isFinite(gid)) return { ok: false, text: `群号不对：${target}` };
        if (!hooks.refresh) return { ok: false, text: "现在拿不到 OneBot 连接，刷不了名册；等它连上再试。" };
        const count = await hooks.refresh(gid);
        return count && count > 0
          ? { ok: true, text: `群 ${gid} 名册已更新，${count} 人。` }
          : { ok: false, text: `群 ${gid} 名册没拉到（群号不对或机器人不在那个群）。` };
      }

      if (groups.length === 0) {
        return { ok: false, text: "还没有任何群的名册（机器人启动时会在它待的群里学一次）。" };
      }
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
      if (rows.length > shown.length) lines.push(`…还有 ${rows.length - shown.length} 人没列。`);
      return { ok: true, text: lines.join("\n") };
    },
  };
  registry.register(tool);
}
