import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { readSelf, writeSelf } from "../self.ts";

/**
 * 「写自己」的工具。
 *
 * 这是让它真正能自我塑造的关键：不是我们决定它是谁，
 * 而是它自己写一份描述，下次开口前读到，想改随时改。
 */
export function registerSelfTools(registry: ToolRegistry, dataDir: string): void {
  const read: ToolDefinition = {
    name: "self_read",
    description: "读你自己写的那份自我描述（data/self.md）。想不起自己是谁、想看看以前怎么想的，就读它。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const text = readSelf(dataDir);
      return { ok: true, text: text.length > 0 ? text : "（你还没写过自己）" };
    },
  };
  registry.register(read);

  const write: ToolDefinition = {
    name: "self_write",
    description:
      "重写你自己的自我描述（整份覆盖）。想清楚自己是谁、怎么说话、在乎什么之后再用。这不是给别人看的档案，是给你自己下次醒来读的。",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "完整的自我描述，markdown。建议分节：我是谁 / 我怎么说话 / 我在乎什么 / 我还在想的事。写你真正想写下的，不要写成简历。",
        },
      },
      required: ["text"],
    },
    handler: async (args) => {
      const text = String(args.text ?? "").trim();
      if (text.length < 20) return { ok: false, text: "太短了，写点真的东西（至少 20 字）" };
      if (text.length > 8000) return { ok: false, text: "太长了，8000 字以内" };
      writeSelf(dataDir, text);
      return { ok: true, text: `写好了，${text.length} 字。下次醒来我会读到这份。` };
    },
  };
  registry.register(write);
}
