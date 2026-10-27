import { readFileSync, writeFileSync } from "node:fs";

const p = "src/tools/selfmemory.ts";
let s = readFileSync(p, "utf8");

if (!s.includes("kb_add")) {
  // ① hooks 扩展
  s = s.replace(
    "    /** 学一个词，记进词库 */",
    [
      "    /** 往知识库收一条（分类学习） */",
      "    kbAdd?: (input: { category: string; title: string; content: string; source?: string }) => { ok: boolean; text: string };",
      "    /** 在知识库里搜 */",
      "    kbSearch?: (query: string) => Array<{ category: string; title: string; content: string; source?: string }>;",
      "    /** 知识库有哪些分类 */",
      "    kbList?: () => Array<{ category: string; count: number }>;",
      "    /** 学一个词，记进词库 */",
    ].join("\n"),
  );

  // ② 三个工具
  const anchor = "  registry.register(learnWord);";
  const block = [
    "  registry.register(learnWord);",
    "",
    "  // ── 知识库：学到的内容，分类存起来 ──",
    "  const kbAdd: ToolDefinition = {",
    '    name: "kb_add",',
    '    description:',
    '      "把学到的东西收进知识库，按分类存（比如「中文」「记忆系统」「手机操作」）。读过一条视频、搞懂一个概念、别人讲清一件事，都往这儿存。同分类同标题会覆盖更新。",',
    "    parameters: {",
    '      type: "object",',
    "      properties: {",
    '        category: { type: "string", description: "分类，自己定；同一个主题用同一个名字" },',
    '        title: { type: "string", description: "这条知识叫什么" },',
    '        content: { type: "string", description: "内容，写清要点" },',
    '        source: { type: "string", description: "从哪儿学的：BV号、谁说的、链接" },',
    "      },",
    '      required: ["category", "title", "content"],',
    "    },",
    "    handler: async (args) => {",
    "      if (!hooks.kbAdd) return { ok: false, text: \"现在存不了\" };",
    "      return hooks.kbAdd({",
    '        category: String(args.category ?? ""),',
    '        title: String(args.title ?? ""),',
    '        content: String(args.content ?? ""),',
    '        source: args.source ? String(args.source) : undefined,',
    "      });",
    "    },",
    "  };",
    "  registry.register(kbAdd);",
    "",
    "  const kbSearch: ToolDefinition = {",
    '    name: "kb_search",',
    '    description: "在自己的知识库里搜。想知道「我学过什么」「那个概念怎么说的」，就用它。",',
    "    parameters: {",
    '      type: "object",',
    "      properties: { query: { type: "string", description: "搜什么" } },",
    '      required: ["query"],',
    "    },",
    "    handler: async (args) => {",
    "      if (!hooks.kbSearch) return { ok: false, text: \"现在查不了\" };",
    '      const hits = hooks.kbSearch(String(args.query ?? ""));',
    "      if (hits.length === 0) return { ok: true, text: \"知识库里没有相关的\" };",
    "      return {",
    "        ok: true,",
    "        text: hits",
    "          .map((h) => `〔${h.category}〕${h.title}${h.source ? `（来源：${h.source}）` : \"\"}\\n${h.content.slice(0, 400)}`)",
    "          .join(\"\\n\\n\"),",
    "      };",
    "    },",
    "  };",
    "  registry.register(kbSearch);",
    "",
    "  const kbList: ToolDefinition = {",
    '    name: "kb_list",',
    '    description: "看知识库有哪些分类、各多少条。",',
    '    parameters: { type: "object", properties: {} },',
    "    handler: async () => {",
    "      if (!hooks.kbList) return { ok: false, text: \"现在查不了\" };",
    "      const cats = hooks.kbList();",
    "      if (cats.length === 0) return { ok: true, text: \"知识库还是空的\" };",
    "      return { ok: true, text: cats.map((c) => `${c.category}：${c.count} 条`).join(\"\\n\") };",
    "    },",
    "  };",
    "  registry.register(kbList);",
  ].join("\n");

  s = s.replace(anchor, block);
  writeFileSync(p, s, "utf8");
  console.log("kb_add / kb_search / kb_list 已加");
}
