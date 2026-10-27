import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { describeImage } from "../vision.ts";

/** 让她自己看图：截图、别人发的图、本地文件都行 */
export function registerVisionTools(registry: ToolRegistry): void {
  const see: ToolDefinition = {
    name: "see_image",
    description:
      "看一张图（本地文件路径）。截图、别人发的图都能看。会返回图里有什么、谁在做什么、有文字就照抄关键的。看图要几秒，别对同一张反复看。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "图片的本地路径" },
        question: { type: "string", description: "想特别看什么（不填就让它自己描述）" },
      },
      required: ["path"],
    },
    handler: async (args) => {
      const file = String(args.path ?? "").trim();
      if (file.length === 0) return { ok: false, text: "给个路径" };
      const q = args.question ? String(args.question) : undefined;
      const r = await describeImage(file, q);
      if (!r.ok) return { ok: false, text: r.text };
      return { ok: true, text: `${r.text}（${(r.ms / 1000).toFixed(1)} 秒）` };
    },
  };
  registry.register(see);
}
