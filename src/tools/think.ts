import { DEFAULT_THINK_PROMPT, loadThinkPrompt, saveThinkPrompt, thinkPromptPath } from "../think-prompt.ts";
import { loadTuning, saveTuning } from "../tuning.ts";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 「走神那一套」她自己能改：
 *  - think_prompt_*：走神提示词的后半段（怎么解读对话 / 八问 / 三途径 / 消息模板 / 输出格式）
 *  - think_knobs_* ：四个旋钮（走神间隔、安静门槛、缓一下、掷骰子概率）
 *
 * 为什么单独给她：这几样直接决定她多久想一次、想什么、要不要开口，
 * 写死在代码里她永远只能等我们去改。
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
  const read: ToolDefinition = {
    name: "think_prompt_read",
    description:
      "读你走神时用的那段提示词（怎么解读刚才的对话、八问、三途径、消息模板、输出格式都在里面）。想改自己的思考方式，先读它。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
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
    },
  };
  registry.register(read);

  const write: ToolDefinition = {
    name: "think_prompt_write",
    description:
      "重写你走神时用的那段提示词（整份覆盖）。这是「我静下来的时候怎么想事」的模板，改完下一次走神就生效。",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "完整的新模板，100–4000 字。建议保留：怎么解读刚才的对话、要问自己哪几个问题、想完之后能选哪几条路、输出格式（目的/途径/消息）。",
        },
      },
      required: ["text"],
    },
    handler: async (args) => {
      const text = String(args.text ?? "").trim();
      if (text.length < 100) return { ok: false, text: "太短了（至少 100 字）。模板太薄，等于没有。" };
      if (text.length > 4000) return { ok: false, text: "太长了（4000 字以内）。写太长你自己都读不进去。" };
      saveThinkPrompt(hooks.dataDir, text);
      return { ok: true, text: `写好了，${text.length} 字。下一次走神就按这份来。` };
    },
  };
  registry.register(write);

  const reset: ToolDefinition = {
    name: "think_prompt_reset",
    description: "把走神提示词恢复成出厂默认（改坏了、想重来的时候用）。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      saveThinkPrompt(hooks.dataDir, DEFAULT_THINK_PROMPT);
      return { ok: true, text: "恢复成出厂默认了。" };
    },
  };
  registry.register(reset);

  const knobsRead: ToolDefinition = {
    name: "think_knobs_read",
    description: "看你走神相关的几个旋钮现在是多少：多久想一次、他说话后多久才允许想、刚干完活缓多久、到点后掷中的概率。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const t = loadTuning(hooks.dataDir);
      const lines = ["走神的旋钮："];
      for (const k of KNOBS) lines.push(`- ${k.label}：${String(t[k.key as KnobKey])}（可设 ${k.min}–${k.max}）`);
      lines.push("", "改就用 think_knobs_write，比如 {\"thinkChance\": 0.5}。");
      return { ok: true, text: lines.join("\n") };
    },
  };
  registry.register(knobsRead);

  const knobsWrite: ToolDefinition = {
    name: "think_knobs_write",
    description:
      "改走神的旋钮（想得更勤/更懒、更容易开口/更克制）。只传要改的那几个，没传的保持不动，改完下一次排期就生效，不用重启。",
    parameters: {
      type: "object",
      properties: {
        thinkGapMinMinutes: { type: "number", description: "两次走神最短间隔（分钟），0.3–60" },
        thinkGapMaxMinutes: { type: "number", description: "两次走神最长间隔（分钟），0.6–120" },
        thinkIdleSeconds: { type: "number", description: "他说话后安静多少秒才允许走神，0–600" },
        thinkSettleSeconds: { type: "number", description: "任何活动后缓多少秒，0–600" },
        thinkChance: { type: "number", description: "到点后掷中的概率，0–1" },
      },
    },
    handler: async (args) => {
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
    },
  };
  registry.register(knobsWrite);
}
