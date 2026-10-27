import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/** 问顾问：遇到搞不定的问题，发给后台那个「技术顾问」，别半夜把主人吵醒 */
export function registerMentorTools(
  registry: ToolRegistry,
  hooks: {
    ask?: (question: string, context?: string) => { ok: boolean; text: string };
    replies?: () => Array<{ answer: string }>;
  },
): void {
  const ask: ToolDefinition = {
    name: "ask_mentor",
    description:
      "遇到自己搞不定的技术问题，发给技术顾问（一个在后台的人）。适合：架构怎么改、为什么会这样、下一步该做什么。不适合：日常闲聊、想找人说说话。发完就能继续干别的，回复会在之后的对话里出现。",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "你想问什么，说清背景和你试过什么" },
        context: { type: "string", description: "相关的现状或你查到的数据" },
      },
      required: ["question"],
    },
    handler: async (args) => {
      if (!hooks.ask) return { ok: false, text: "顾问通道没开" };
      return hooks.ask(String(args.question ?? ""), args.context ? String(args.context) : undefined);
    },
  };
  registry.register(ask);

  const check: ToolDefinition = {
    name: "mentor_replies",
    description: "看顾问回没回你。发过问题之后隔一阵查一次。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      if (!hooks.replies) return { ok: false, text: "顾问通道没开" };
      const list = hooks.replies();
      if (list.length === 0) return { ok: true, text: "还没回。" };
      return { ok: true, text: list.map((r) => r.answer).join("\n\n---\n\n") };
    },
  };
  registry.register(check);
}
