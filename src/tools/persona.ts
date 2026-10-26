import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { DEFAULT_PERSONA, PERSONA_FLOOR, loadPersonaText, personaPath, savePersonaText } from "../bot/persona.ts";

/**
 * 「看见并修改自己的人格提示词」。
 *
 * 和 self_write 的区别：
 *  · self.md 是**她写的自我描述**（我是谁、我在乎什么），随她改；
 *  · persona.md 是**人格底色**（怎么想事、怎么说话的那套规则），以前硬编码在代码里。
 *    现在她既能看到全文，也能改——但底线（不编造/不演客服/分清谁说的）是代码固定的，
 *    一并在 persona_read 里给她看，省得她以为改了它会消失。
 */
export function registerPersonaTools(registry: ToolRegistry, dataDir?: string): void {
  const read: ToolDefinition = {
    name: "persona_read",
    description:
      "读你自己的人格提示词（persona.md）——每次开口前它都会出现在你脑子里，决定你怎么想事、怎么说话。想改自己的性格，先读它。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const text = loadPersonaText(dataDir);
      const where = personaPath(dataDir);
      const fromFile = text !== DEFAULT_PERSONA;
      return {
        ok: true,
        text: [
          `（来源：${fromFile ? where : "出厂默认（还没有 persona.md，改一次就会生成这个文件）"}）`,
          "",
          text,
          "",
          "——— 下面这一段是固定的，改不了 ———",
          PERSONA_FLOOR,
        ].join("\n"),
      };
    },
  };
  registry.register(read);

  const write: ToolDefinition = {
    name: "persona_write",
    description:
      "重写你自己的人格提示词（整份覆盖 persona.md）。这是决定你思维方式的那份「底色」，不是自我描述（那个用 self_write）。改完下一次开口就生效，不用重启。",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "完整的人格提示词，markdown 或分节都行。建议写清：我怎么想事、我怎么说话、我的弱点、我坚持什么。100–6000 字。",
        },
      },
      required: ["text"],
    },
    handler: async (args) => {
      const text = String(args.text ?? "").trim();
      if (text.length < 100) return { ok: false, text: "太短了（至少 100 字）。人格底色写得太薄，等于没有。" };
      if (text.length > 6000) return { ok: false, text: "太长了（6000 字以内）。写长了自己都不一定读得进去。" };
      savePersonaText(text, dataDir);
      return { ok: true, text: `写好了，${text.length} 字。下一次开口就会按这份来（底线那几条仍然固定）。` };
    },
  };
  registry.register(write);

  const reset: ToolDefinition = {
    name: "persona_reset",
    description: "把你的人格提示词恢复成出厂默认（反悔、或者改坏了的时候用）。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      savePersonaText(DEFAULT_PERSONA, dataDir);
      return { ok: true, text: "恢复成出厂默认了。" };
    },
  };
  registry.register(reset);
}
