import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { loadExtractRules, rulesPath } from "../extract-rules.ts";
import { loadSpeechRules, speechRulesPath } from "../speech-rules.ts";
import { buildMessages } from "../llm/extract.ts";
import { loadTuning } from "../tuning.ts";

/**
 * 核对：我改的东西，到底有没有进到真正生效的那份提示词里。
 *
 * 为什么需要：
 *   「改了没生效」最难发现——文件写对了、代码也对，但读的和写的是两个地方。
 *   今天在这上面栽了三次：缓存没失效、解析被冲、统计漏了过滤条件。
 *   这个工具把「文件里有什么」和「提示词里有什么」并排打出来，缺哪条一眼看见。
 */
export function registerVerifyTools(registry: ToolRegistry, hooks: { dataDir: string }): void {
  const tool: ToolDefinition = {
    name: "verify_rules",
    description:
      "核对你自己写的规则有没有真的生效：文件里有哪些条、真正喂给模型的提示词里有没有这些条。改了规则之后用一次，别靠感觉以为自己改好了。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const lines: string[] = [];
      const dataDir = hooks.dataDir;

      // ① 抽取规则
      const extractRules = loadExtractRules(dataDir);
      const extractLines = extractRules.split("\n").map((l) => l.trim()).filter((l) => l.length > 3);
      let promptText = "";
      try {
        const msgs = buildMessages(
          "2000-01-01",
          [{ id: "probe", role: "user", text: "核对用", speakerId: "0" }],
          { user: "对方", assistant: "凝" },
          [],
          dataDir,
        );
        promptText = msgs.map((m) => String(m.content)).join("\n");
      } catch (err) {
        lines.push(`抽取提示词读不出来：${err instanceof Error ? err.message : String(err)}`);
      }

      const missingExtract = extractLines.filter((l) => !promptText.includes(l.slice(0, 20)));
      lines.push(`【抽取规则】文件 ${extractLines.length} 条，提示词里缺 ${missingExtract.length} 条`);
      lines.push(`  文件：${rulesPath(dataDir)}`);
      for (const m of missingExtract.slice(0, 5)) lines.push(`  ✗ 没进提示词：${m.slice(0, 40)}`);
      if (missingExtract.length === 0 && extractLines.length > 0) lines.push("  ✓ 每条都在");

      // ② 说话规矩
      const speech = loadSpeechRules(dataDir);
      const speechLines = speech.split("\n").map((l) => l.trim()).filter((l) => l.length > 3);
      lines.push("");
      lines.push(`【说话规矩】文件 ${speechLines.length} 条`);
      lines.push(`  文件：${speechRulesPath(dataDir)}`);
      lines.push(
        speechLines.length > 0
          ? "  ✓ 每轮对话都会追加（改了下一句就生效）"
          : "  （还没写过）",
      );

      // ③ 参数
      const t = loadTuning(dataDir);
      lines.push("");
      lines.push("【当前参数】");
      lines.push(
        `  群聊门槛 ${t.groupSpeakThreshold}｜沉默判断 ${t.silentCheckMinutes} 分｜放弃等待 ${t.silentGiveUpMinutes} 分`,
      );
      lines.push(
        `  说话温度 ${t.replyTemperature}｜抽取温度 ${t.extractTemperature}｜工具轮次 ${t.maxToolRounds}`,
      );

      return { ok: true, text: lines.join("\n") };
    },
  };
  registry.register(tool);
}
