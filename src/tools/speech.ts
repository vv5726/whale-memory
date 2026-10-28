import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { loadSpeechRules, saveSpeechRules, speechRulesPath } from "../speech-rules.ts";

/**
 * 太长就开始稀释：她今天一天从 1,094 字写到 3,812 字，而这段每句话都要重发一遍。
 * 超过这个字数就提醒她合并/删减——只提醒，不拦。
 */
const TOO_LONG = 3000;

function lengthHint(len: number): string {
  if (len < TOO_LONG) return "";
  return (
    `\n\n⚠️ 现在 ${len} 字了（超过 ${TOO_LONG}）。` +
    "规矩越长越稀释——同一段话里，靠前的规矩会被靠后的挤掉，写到某个长度就等于没写。" +
    "注意结构和总字数：重复的合并，很久没用上的删掉，别让它长得比人格还长。"
  );
}

/** 让她自己管「我怎么说话」（read/write/add 合成一个，2026-10-27） */
export function registerSpeechTools(registry: ToolRegistry, hooks: { dataDir: string }): void {
  const tool: ToolDefinition = {
    name: "speech",
    description:
      "管你自己写的「说话规矩」——会追加到每轮对话的提示词末尾，立刻生效（代码里的底线你看不到，这部分是你自己的）。\n\naction：get 看现在写了什么、set 整份重写、add 在后面加一条。\n\n适合写：什么场合说多说少、哪些话不该说、自己的口头习惯。不适合写：输出格式、人格设定（那个用 self_write / persona）。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "set", "add"], description: "get 读 / set 整份重写 / add 追加一条" },
        text: { type: "string", description: "action=set 时是完整新规矩；action=add 时是要加的那一条" },
      },
      required: ["action"],
    },
    handler: async (args) => {
      const action = String(args.action ?? "get");

      if (action === "get") {
        const t = loadSpeechRules(hooks.dataDir);
        return { ok: true, text: t.length > 0 ? t : "你还没写过。现在按默认的语气说。" };
      }

      if (action === "set") {
        const t = String(args.text ?? "");
        if (t.trim().length < 4) return { ok: false, text: "太短了，写清楚点" };
        saveSpeechRules(hooks.dataDir, t);
        return { ok: true, text: `说话规矩已更新（${t.trim().length} 字），下一句就用上。${lengthHint(t.trim().length)}` };
      }

      if (action === "add") {
        const a = String(args.text ?? "").trim();
        if (a.length < 3) return { ok: false, text: "太短了" };
        const cur = loadSpeechRules(hooks.dataDir);
        if (cur.includes(a)) return { ok: true, text: "这条已经在了，没重复加。" };
        const next = cur.length > 0 ? `${cur}\n${a}` : a;
        saveSpeechRules(hooks.dataDir, next);
        return { ok: true, text: `加了一条（共 ${next.length} 字）。${lengthHint(next.length)}` };
      }

      return { ok: false, text: `不认识的 action：${action}（只有 get / set / add）` };
    },
  };
  registry.register(tool);
}
