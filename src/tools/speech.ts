import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { loadSpeechRules, saveSpeechRules, speechRulesPath } from "../speech-rules.ts";

/** 让她自己管「我怎么说话」 */
export function registerSpeechTools(registry: ToolRegistry, hooks: { dataDir: string }): void {
  const read: ToolDefinition = {
    name: "speech_rules_read",
    description: "看你自己写的「说话规矩」（代码里的底线你看不到，这部分是你自己的）。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const t = loadSpeechRules(hooks.dataDir);
      return { ok: true, text: t.length > 0 ? t : "你还没写过。现在按默认的语气说。" };
    },
  };
  registry.register(read);

  const write: ToolDefinition = {
    name: "speech_rules_write",
    description:
      "写「我怎么说话」的规矩，会追加到每轮对话的提示词末尾，立刻生效。一次写全（覆盖上次内容），先 read 一下再改。\n\n适合写：什么场合说多说少、哪些话不该说、自己的口头习惯。\n不适合写：输出格式、你的人格设定（那个用 self_write）。",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "完整的新规矩（会覆盖旧内容）" } },
      required: ["text"],
    },
    handler: async (args) => {
      const t = String(args.text ?? "");
      if (t.trim().length < 4) return { ok: false, text: "太短了，写清楚点" };
      saveSpeechRules(hooks.dataDir, t);
      return { ok: true, text: `说话规矩已更新（${t.trim().length} 字），下一句就用上。` };
    },
  };
  registry.register(write);

  const add: ToolDefinition = {
    name: "speech_rules_add",
    description: "在现有说话规矩后面加一条，不覆盖原来的。",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "要加的一条" } },
      required: ["text"],
    },
    handler: async (args) => {
      const a = String(args.text ?? "").trim();
      if (a.length < 3) return { ok: false, text: "太短了" };
      const cur = loadSpeechRules(hooks.dataDir);
      const next = cur.length > 0 ? `${cur}\n${a}` : a;
      saveSpeechRules(hooks.dataDir, next);
      return { ok: true, text: `加了一条（共 ${next.length} 字）：${speechRulesPath(hooks.dataDir)}` };
    },
  };
  registry.register(add);
}
