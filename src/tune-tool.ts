import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import type { Tuning } from "../tuning.ts";

/** 让她自己调说话的温度和几道门槛 */
export function registerTuneTool(
  registry: ToolRegistry,
  hooks: { getTuning?: () => Tuning; setTuning?: (t: Partial<Tuning>) => Tuning } | undefined,
): void {
  const tool: ToolDefinition = {
    name: "tune_reply",
    description:
      "调自己说话的节奏：说话的温度、抽取的温度、群聊门槛、工具轮次、记忆的价值门槛。改完下一次说话就生效。\n\n两个值得先想清楚的：**温度**调高你的话更有变化，但工具开着的时候容易调错工具、参数写歪；**工具轮次**是每轮都要把前面全部内容重发一遍，轮数翻倍钱翻四倍——回话（replyRounds）和自己活动（actRounds）分开调。",
    parameters: {
      type: "object",
      properties: {
        replyTemperature: {
          type: "number",
          description: "说话的温度 0-1.5：0 每次都一样、调工具最稳；0.9 像人；1.2 很跳但容易调错工具",
        },
        extractTemperature: { type: "number", description: "抽取记忆的温度：0 写成模板，0.3 能写出具体想法" },
        groupSpeakThreshold: { type: "number", description: "群里说话的相关性门槛 0-1：到了才回。调高更安静" },
        silentCheckMinutes: { type: "integer", description: "没人回你时，多少分钟后判断一次" },
        silentGiveUpMinutes: { type: "integer", description: "多少分钟后默认对方在忙、不再等" },
        replyRounds: {
          type: "integer",
          description: "回话时最多调几轮工具（1-60，默认 8）。调高能多办几步，钱按轮数平方涨",
        },
        actRounds: {
          type: "integer",
          description: "你自己活动时最多调几轮工具（1-60，默认 6）：走神、自主活动、计划提醒、主动开口",
        },        v3MinValue: { type: "number", description: "抽取记忆的价值门槛 0-10：调高＝记得更少更准，调低＝记得更多更杂" },
        v3MaxEvents: { type: "integer", description: "一批对话最多记几条（1-30）" },
        planDoneMemoryValue: { type: "number", description: "计划做完写成记忆时给几分 0-10：高＝不容易被压缩，低＝更容易下沉" },
      },
    },
    handler: async (args) => {
      if (!hooks?.getTuning || !hooks?.setTuning) return { ok: false, text: "现在调不了" };
      const before = hooks.getTuning();
      const next = hooks.setTuning({
        replyTemperature: args.replyTemperature === undefined ? undefined : Number(args.replyTemperature),
        extractTemperature: args.extractTemperature === undefined ? undefined : Number(args.extractTemperature),
        groupSpeakThreshold: args.groupSpeakThreshold === undefined ? undefined : Number(args.groupSpeakThreshold),
        silentCheckMinutes: args.silentCheckMinutes === undefined ? undefined : Number(args.silentCheckMinutes),
        silentGiveUpMinutes: args.silentGiveUpMinutes === undefined ? undefined : Number(args.silentGiveUpMinutes),
        replyRounds: args.replyRounds === undefined ? undefined : Number(args.replyRounds),
        actRounds: args.actRounds === undefined ? undefined : Number(args.actRounds),
        v3MinValue: args.v3MinValue === undefined ? undefined : Number(args.v3MinValue),
        v3MaxEvents: args.v3MaxEvents === undefined ? undefined : Number(args.v3MaxEvents),
        planDoneMemoryValue:
          args.planDoneMemoryValue === undefined ? undefined : Number(args.planDoneMemoryValue),
      });
      return {
        ok: true,
        text: [
          `说话温度 ${before.replyTemperature} → ${next.replyTemperature}`,
          `抽取温度 ${before.extractTemperature} → ${next.extractTemperature}`,
          `群聊门槛 ${before.groupSpeakThreshold} → ${next.groupSpeakThreshold}`,
          `沉默判断 ${before.silentCheckMinutes} → ${next.silentCheckMinutes} 分钟`,
          `放弃等待 ${before.silentGiveUpMinutes} → ${next.silentGiveUpMinutes} 分钟`,
          `回话轮次 ${before.replyRounds} → ${next.replyRounds}`,
          `自己活动的轮次 ${before.actRounds} → ${next.actRounds}`,
          `计划完成的分 ${before.planDoneMemoryValue} → ${next.planDoneMemoryValue}`,
        ].join("，"),
      };
    },
  };
  registry.register(tool);
}
