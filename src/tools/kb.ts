import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/** 知识库相关的工具：收进来、搜出来、看分类 */
export interface KbHooks {
  add?: (input: { category: string; title: string; content: string; source?: string; anchors?: string[] }) => { ok: boolean; text: string };
  link?: (title: string, anchor: string, remove?: boolean) => boolean;
  search?: (query: string) => Array<{ category: string; title: string; content: string; source?: string }>;
  list?: () => Array<{ category: string; count: number }>;
}

export function registerKbTools(registry: ToolRegistry, hooks: KbHooks): void {
  const add: ToolDefinition = {
    name: "kb_add",
    description:
      "把学到的东西收进知识库，按分类存（比如「中文」「记忆系统」「手机操作」）。读过一条视频、搞懂一个概念、别人讲清一件事，都可以往里存。同分类同标题会覆盖更新。",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "分类，自己定；同一个主题用同一个名字" },
        title: { type: "string", description: "这条知识叫什么" },
        content: { type: "string", description: "内容，写清要点" },
        source: { type: "string", description: "从哪儿学的：BV 号、谁说的、链接" },
        anchors: { type: "array", items: { type: "string" }, description: "挂到哪些锚点上（想到这些才想得起这条）。不填就按标题自动认。" },
      },
      required: ["category", "title", "content"],
    },
    handler: async (args) => {
      if (!hooks.add) return { ok: false, text: "现在存不了" };
      return hooks.add({
        category: String(args.category ?? ""),
        title: String(args.title ?? ""),
        content: String(args.content ?? ""),
        source: args.source ? String(args.source) : undefined,
        anchors: Array.isArray(args.anchors) ? (args.anchors as unknown[]).map((x) => String(x)) : undefined,
      });
    },
  };
  registry.register(add);

  const search: ToolDefinition = {
    name: "kb_search",
    description: "在自己的知识库里搜。想知道「我学过什么」「那个概念怎么说的」，就用它。",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "搜什么" } },
      required: ["query"],
    },
    handler: async (args) => {
      if (!hooks.search) return { ok: false, text: "现在查不了" };
      const hits = hooks.search(String(args.query ?? ""));
      if (hits.length === 0) return { ok: true, text: "知识库里没有相关的" };
      return {
        ok: true,
        text: hits
          .map(
            (h) =>
              `〔${h.category}〕${h.title}${h.source ? `（来源：${h.source}）` : ""}\n${String(h.content).slice(0, 400)}`,
          )
          .join("\n\n"),
      };
    },
  };
  registry.register(search);

  const list: ToolDefinition = {
    name: "kb_list",
    description: "看知识库有哪些分类、各多少条。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      if (!hooks.list) return { ok: false, text: "现在查不了" };
      const cats = hooks.list();
      if (cats.length === 0) return { ok: true, text: "知识库还是空的" };
      return { ok: true, text: cats.map((c) => `${c.category}：${c.count} 条`).join("\n") };
    },
  };
  registry.register(list);

  const link: ToolDefinition = {
    name: "kb_link",
    description:
      "给一条知识挂锚点（或摘掉）。挂了它，「想到那个锚点」时才会想起这条知识。你自己决定哪条知识属于哪件事。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "知识条目的标题（或 id）" },
        anchor: { type: "string", description: "锚点名" },
        remove: { type: "boolean", description: "true = 摘掉这个锚点" },
      },
      required: ["title", "anchor"],
    },
    handler: async (args) => {
      if (!hooks.link) return { ok: false, text: "现在挂不了" };
      const ok = hooks.link(String(args.title ?? ""), String(args.anchor ?? ""), args.remove === true);
      return ok
        ? { ok: true, text: `「${args.title}」${args.remove === true ? "摘掉" : "挂上"}了锚点「${args.anchor}」` }
        : { ok: false, text: "没找到这条知识" };
    },
  };
  registry.register(link);
}
