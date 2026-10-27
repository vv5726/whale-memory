import { DEFAULT_THINK_PROMPT, loadThinkPrompt, saveThinkPrompt, thinkPromptPath } from "../think-prompt.ts";
import { loadTuning, saveTuning } from "../tuning.ts";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 「走神那一套」她自己能改：
 *  - prompt：走神提示词的后半段（怎么解读对话 / 八问 / 三途径 / 消息模板 / 输出格式）
 *  - knobs ：五个旋钮（走神间隔、安静门槛、缓一下、掷骰子概率）
 *
 * 为什么单独给她：这几样直接决定她多久想一次、想什么、要不要开口，
 * 写死在代码里她永远只能等我们去改。
 *
 * 2026-10-27：原来五个工具（prompt_read/write/reset + knobs_read/write）合成一个带 action 的。
 */
const KNOBS = [
  { key: "thinkGapMinMinutes", label: "两次走神最短间隔（分钟）", min: 0.3, max: 60 },
  { key: "thinkGapMaxMinutes", label: "两次走神最长间隔（分钟）", min: 0.6, max: 120 },
  { key: "thinkIdleSeconds", label: "他说话后安静多少秒才允许走神", min: 0, max: 600 },
  { key: "thinkSettleSeconds", label: "任何活动后缓多少秒", min: 0, max: 600 },
  { key: "thinkChance", label: "到点后掷中的概率（0-1）", min: 0, max: 1 },
] as const;

type KnobKey = (typeof KNOBS)[number]["key"];

export function registerThinkTools(registry: ToolRegistry, hooks: { dataDir: string }): void {
  const tool: ToolDefinition = {
    name: "think",
    description:
      "管你「走神」这一套：提示词（怎么解读刚才的对话、八问、三途径、消息模板、输出格式）+ 五个旋钮（多久想一次、他说话后多久才允许想、刚干完活缓多久、到点掷中的概率）。\n\naction：\n- prompt_get 读走神提示词、prompt_set 整份重写、prompt_reset 回出厂\n- knobs_get 看五个旋钮、knobs_set 改（只传要改的，没传的保持不动）\n改完下一次走神/排期就生效，不用重启。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["prompt_get", "prompt_set", "prompt_reset", "knobs_get", "knobs_set"],
          description: "prompt_get / prompt_set / prompt_reset / knobs_get / knobs_set",
        },
        text: { type: "string", description: "action=prompt_set 时必填：完整的新模板（100–4000 字）" },
        thinkGapMinMinutes: { type: "number", description: "knobs_set：两次走神最短间隔（分钟），0.3–60" },
        thinkGapMaxMinutes: { type: "number", description: "knobs_set：两次走神最长间隔（分钟），0.6–120" },
        thinkIdleSeconds: { type: "number", description: "knobs_set：他说话后安静多少秒才允许走神，0–600" },
        thinkSettleSeconds: { type: "number", description: "knobs_set：任何活动后缓多少秒，0–600" },
        thinkChance: { type: "number", description: "knobs_set：到点后掷中的概率，0–1" },
      },
      required: ["action"],
    },
    handler: async (args) => {
      const action = String(args.action ?? "prompt_get");

      if (action === "prompt_get") {
        const text = loadThinkPrompt(hooks.dataDir);
        const fromFile = text !== DEFAULT_THINK_PROMPT.trim();
        return {
          ok: true,
          text: [
            `（来源：${fromFile ? thinkPromptPath(hooks.dataDir) : "出厂默认（还没有 think-prompt.md，改一次就会生成）"}）`,
            "",
            text,
          ].join("\n"),
        };
      }

      if (action === "prompt_set") {
        const text = String(args.text ?? "").trim();
        if (text.length < 100) return { ok: false, text: "太短了（至少 100 字）。模板太薄，等于没有。" };
        if (text.length > 4000) return { ok: false, text: "太长了（4000 字以内）。写太长你自己都读不进去。" };
        saveThinkPrompt(hooks.dataDir, text);
        return { ok: true, text: `写好了，${text.length} 字。下一次走神就按这份来。` };
      }

      if (action === "prompt_reset") {
        saveThinkPrompt(hooks.dataDir, DEFAULT_THINK_PROMPT);
        return { ok: true, text: "恢复成出厂默认了。" };
      }

      if (action === "knobs_get") {
        const t = loadTuning(hooks.dataDir);
        const lines = ["走神的旋钮："];
        for (const k of KNOBS) lines.push(`- ${k.label}：${String(t[k.key as KnobKey])}（可设 ${k.min}–${k.max}）`);
        lines.push("", "改就用 knobs_set，比如 action=knobs_set + thinkChance=0.5。");
        return { ok: true, text: lines.join("\n") };
      }

      if (action === "knobs_set") {
        const patch: Record<string, number> = {};
        const notes: string[] = [];
        for (const k of KNOBS) {
          const v = args[k.key];
          if (typeof v === "number" && Number.isFinite(v)) {
            patch[k.key] = v;
            if (v < k.min || v > k.max) notes.push(`${k.label} 超出范围，已收到 ${k.min}–${k.max}`);
          }
        }
        if (Object.keys(patch).length === 0) return { ok: false, text: "没有要改的（五个旋钮一个都没传）。" };
        const before = loadTuning(hooks.dataDir);
        const after = saveTuning(hooks.dataDir, patch);
        const lines = ["改好了："];
        for (const k of Object.keys(patch)) lines.push(`- ${k}：${String(before[k as KnobKey])} → ${String(after[k as KnobKey])}`);
        if (notes.length > 0) lines.push("", ...notes);
        lines.push("", "下一次排期就生效（不用重启）。");
        return { ok: true, text: lines.join("\n") };
      }

      return { ok: false, text: `不认识的 action：${action}（只有 prompt_get / prompt_set / prompt_reset / knobs_get / knobs_set）` };
    },
  };
  registry.register(tool);
}
