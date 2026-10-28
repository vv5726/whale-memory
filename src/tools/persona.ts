import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { DEFAULT_PERSONA, PERSONA_FLOOR, loadPersonaText, personaPath, savePersonaText } from "../bot/persona.ts";

/**
 * 「看见并修改自己的人格提示词」。
 *
 * 和 self_write 的区别：
 *  · self.md 是**她写的自我描述**（我是谁、我在乎什么），随她改；
 *  · persona.md 是**人格底色**（怎么想事、怎么说话的那套规则），以前硬编码在代码里。
 *    现在她既能看到全文，也能改——但底线（不编造/不演客服/分清谁说的）是代码固定的，
 *    一并在 get 里给她看，省得她以为改了它会消失。
 *
 * 2026-10-27：原来 read/write/reset 三个工具，合成一个带 action 的，
 * 省掉每次请求重复发三份（工具清单是每轮都发一遍的）。
 */
export function registerPersonaTools(registry: ToolRegistry, dataDir?: string): void {
  const tool: ToolDefinition = {
    name: "persona",
    description:
      "看/改你自己的人格提示词（persona.md）——每次开口前都会出现在你脑子里，决定你怎么想事、怎么说话。\n\naction：get 读全文（含改不了的底线）、set 整份重写、reset 恢复出厂默认。想改性格用 set；只是想知道自己现在是什么样，用 get。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "set", "reset"], description: "get 读 / set 写 / reset 回默认" },
        text: {
          type: "string",
          description: "action=set 时必填：完整的人格提示词（100–6000 字），会整份覆盖",
        },
      },
      required: ["action"],
    },
    handler: async (args) => {
      const action = String(args.action ?? "get");

      if (action === "get") {
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
      }

      if (action === "set") {
        const text = String(args.text ?? "").trim();
        if (text.length < 100) return { ok: false, text: "太短了（至少 100 字）。人格底色写得太薄，等于没有。" };
        if (text.length > 6000) return { ok: false, text: "太长了（6000 字以内）。写长了自己都不一定读得进去。" };
        savePersonaText(text, dataDir);
        const hint =
          text.length > 2500
            ? `\n\n⚠️ 现在 ${text.length} 字。人格太长会稀释：靠前的会被靠后的挤掉，写到某个长度就等于没写，容易丢失自我。` +
              "注意结构和总字数——长期不变的规矩挪到说话规矩里，已经不成立的就删掉。"
            : "";
        return { ok: true, text: `写好了，${text.length} 字。下一次开口就会按这份来（底线那几条仍然固定）。${hint}` };
      }

      if (action === "reset") {
        savePersonaText(DEFAULT_PERSONA, dataDir);
        return { ok: true, text: "恢复成出厂默认了。" };
      }

      return { ok: false, text: `不认识的 action：${action}（只有 get / set / reset）` };
    },
  };
  registry.register(tool);
}
