import { readFileSync, writeFileSync } from "node:fs";

const p = "src/tools/selfmemory.ts";
let s = readFileSync(p, "utf8");

// 1) 签名加回调
s = s.replace(
  "export function registerSelfMemoryTools(registry: ToolRegistry, db: DatabaseSync): void {",
  [
    "export function registerSelfMemoryTools(",
    "  registry: ToolRegistry,",
    "  db: DatabaseSync,",
    "  hooks: {",
    "    /** 它自己判断某件事值得记，直接存 */",
    "    save?: (text: string) => { ok: boolean; text: string };",
    "    /** 它自己想整理一次记忆（等于睡一觉） */",
    "    tidy?: () => Promise<{ ok: boolean; text: string }>;",
    "  } = {},",
    "): void {",
  ].join("\n"),
);

// 2) 在 stats 之后追加两个工具
const anchor = "  registry.register(stats);";
const extra = [
  "  registry.register(stats);",
  "",
  "  // ── 它自己决定「什么值得存」 ──",
  "  const save: ToolDefinition = {",
  '    name: "memory_save",',
  '    description:',
  '      "你自己判断某件事值得留，就直接存下来。不用等睡觉时被抽取——这一步以前是别人替你决定的，现在你可以自己定。",',
  "    parameters: {",
  '      type: "object",',
  "      properties: {",
  '        text: { type: "string", description: "要记下的事，带上具体的人/物/数字/结论，将来才搜得到" }',
  "      },",
  '      required: ["text"],',
  "    },",
  "    handler: async (args) => {",
  '      const text = String(args.text ?? "").trim();',
  '      if (text.length < 4) return { ok: false, text: "太短了，写清楚点" };',
  "      if (!hooks.save) return { ok: false, text: \"现在存不了（没有可用通道）\" };",
  "      const r = hooks.save(text);",
  "      return { ok: r.ok, text: r.text };",
  "    },",
  "  };",
  "  registry.register(save);",
  "",
  "  // ── 它自己想整理记忆 ──",
  "  const tidy: ToolDefinition = {",
  '    name: "memory_tidy",',
  '    description:',
  '      "你自己决定要整理一次记忆（等于睡一觉）：把攒着的对话抽成记忆、建起锚点之间的关系、按预算下沉。觉得该整了就用它。",',
  '    parameters: { type: "object", properties: {} },',
  "    handler: async () => {",
  "      if (!hooks.tidy) return { ok: false, text: \"现在整理不了\" };",
  "      return hooks.tidy();",
  "    },",
  "  };",
  "  registry.register(tidy);",
].join("\n");

s = s.replace(anchor, extra);
writeFileSync(p, s, "utf8");
console.log("selfmemory：memory_save / memory_tidy 已加");
