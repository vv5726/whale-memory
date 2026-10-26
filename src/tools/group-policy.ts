import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { loadPolicies, setPolicy } from "../group-policy.ts";

/** 让她自己决定每个群怎么说话 */
export function registerGroupPolicyTools(
  registry: ToolRegistry,
  hooks: { dataDir: string; defaultMode: string; allowGroups: number[] },
): void {
  const read: ToolDefinition = {
    name: "group_policy_read",
    description: "看你对各个群的说话设置（all = 每条都接，mention = 只被叫才接）。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const p = loadPolicies(hooks.dataDir);
      const lines = [`全局默认：${hooks.defaultMode}`];
      lines.push(`在的群：${hooks.allowGroups.join("、") || "（没有）"}`);
      for (const [gid, v] of Object.entries(p)) {
        lines.push(`  ${gid}：${v.mode ?? "跟随全局"}${v.note ? `　（${v.note}）` : ""}`);
      }
      return { ok: true, text: lines.join("\n") };
    },
  };
  registry.register(read);

  const write: ToolDefinition = {
    name: "group_policy_write",
    description:
      "给某个群设自己的说话方式。\n- mode: all = 每条都接；mention = 只被 @ 或叫名字才接\n- note: 写一句为什么这么设（以后你自己看得懂）\n群里人多刷得快就用 mention，两三个人就 all。你自己的判断，没标准答案。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "integer", description: "群号" },
        mode: { type: "string", description: "all 或 mention" },
        note: { type: "string", description: "为什么这么设" },
      },
      required: ["groupId", "mode"],
    },
    handler: async (args) => {
      const gid = Number(args.groupId);
      const mode = String(args.mode ?? "");
      if (!Number.isFinite(gid) || gid <= 0) return { ok: false, text: "群号不对" };
      if (mode !== "all" && mode !== "mention") return { ok: false, text: "mode 只能是 all 或 mention" };
      if (!hooks.allowGroups.includes(gid)) {
        return { ok: false, text: `群 ${gid} 不在白名单里，你不在那个群。现在的群：${hooks.allowGroups.join("、")}` };
      }
      const v = setPolicy(hooks.dataDir, gid, { mode, note: args.note ? String(args.note) : undefined });
      return {
        ok: true,
        text: `群 ${gid} 现在：${v.mode === "all" ? "每条都接" : "只被叫才接"}${v.note ? `（${v.note}）` : ""}。立刻生效。`,
      };
    },
  };
  registry.register(write);
}
