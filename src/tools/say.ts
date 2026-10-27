import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 直接把一句话发出去，不用去点手机界面。
 *
 * 为什么要它：以前她要往群里说话，只能一路 phone_open_app → screenshot → dump_ui
 * → tap → type → tap 发送，一条链吃掉 6–9 轮工具调用，还经常在最后一步被轮次截断。
 * 2026-10-27 09:56 那次就是这么断的：输入框点上了，话没发出去。
 *
 * 投递仍然走 resolveSendTarget：群号 → 那个群；人名 → 私聊（不是好友就找他所在的群）；
 * 留空 → 最近在聊的那个会话。
 */
export function registerSayTools(
  registry: ToolRegistry,
  hooks: { deliver?: (text: string, target?: string) => Promise<{ ok: boolean; text: string }> },
): void {
  const tool: ToolDefinition = {
    name: "say_to",
    description:
      "直接把一句话发出去（群、私聊都行），不用去点手机界面。\n\ntarget 填群号（例如 20001）就发到那个群；填名字就发私聊（不是好友的话会去他所在的群）；留空发最近在聊的那个会话。\n\n只发一句话，不带工具、不带解释。想先看看群里在聊什么再决定说什么，用 memory_recent（scope=group）。",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "要发出去的那句话（一行，别写成小作文）" },
        target: { type: "string", description: "群号或人名；留空 = 最近在聊的会话" },
      },
      required: ["text"],
    },
    handler: async (args) => {
      const text = String(args.text ?? "").trim();
      if (text.length === 0) return { ok: false, text: "发什么？text 是空的" };
      if (text.length > 1200) return { ok: false, text: `太长了（${text.length} 字），一句话发不完` };
      if (!hooks.deliver) return { ok: false, text: "现在发不出去（没接上 OneBot）" };
      const target = args.target === undefined || args.target === null ? "" : String(args.target).trim();
      try {
        return await hooks.deliver(text, target);
      } catch (e) {
        return { ok: false, text: `发送失败：${e instanceof Error ? e.message : e}` };
      }
    },
  };
  registry.register(tool);
}
