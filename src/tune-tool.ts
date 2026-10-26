import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import type { Tuning } from "../tuning.ts";

/** 让她自己调「回完话要不要回头看」的概率 */
export function registerTuneTool(
  registry: ToolRegistry,
  hooks: { getTuning?: () => Tuning; setTuning?: (t: Partial<Tuning>) => Tuning } | undefined,
): void {
  const tool: ToolDefinition = {
    name: "tune_reply",
    description:
      "调自己说话的节奏。followUpChance 是「回完一句之后，有多大概率再回头看一遍想不想补话」（0-1，默认 0.6）；followUpRounds 是最多回头看几遍（1-5）。觉得话说太碎就调低，觉得老是说一半就没下文就调高。",
    parameters: {
      type: "object",
      properties: {
        followUpChance: { type: "number", description: "0-1 之间的小数" },
        followUpRounds: { type: "integer", description: "1-5" },
        replyTemperature: { type: "number", description: "说话的温度：0 每次都一样，0.9 有点变化，1.2 很跳" },
        extractTemperature: { type: "number", description: "抽取记忆的温度：0 写成模板，0.3 能写出具体想法" },
        groupSpeakThreshold: { type: "number", description: "群里说话的相关性门槛 0-1：到了才回。调高更安静" },
        silentCheckMinutes: { type: "integer", description: "没人回你时，多少分钟后判断一次" },
        silentGiveUpMinutes: { type: "integer", description: "多少分钟后默认对方在忙、不再等" },
        maxToolRounds: { type: "integer", description: "一次最多调几轮工具；0 = 不限（默认），只有想硬刹车时才设正数" },
        v3MinValue: { type: "number", description: "抽取记忆的价值门槛 0-10：调高＝记得更少更准，调低＝记得更多更杂" },
        v3MaxEvents: { type: "integer", description: "一批对话最多记几条（1-30）" },
        planDoneMemoryValue: { type: "number", description: "计划做完写成记忆时给几分 0-10：高＝不容易被压缩，低＝更容易下沉" },
      },
    },
    handler: async (args) => {
      if (!hooks?.getTuning || !hooks?.setTuning) return { ok: false, text: "现在调不了" };
      const before = hooks.getTuning();
      const next = hooks.setTuning({
        followUpChance: args.followUpChance === undefined ? undefined : Number(args.followUpChance),
        followUpRounds: args.followUpRounds === undefined ? undefined : Number(args.followUpRounds),
        replyTemperature: args.replyTemperature === undefined ? undefined : Number(args.replyTemperature),
        extractTemperature: args.extractTemperature === undefined ? undefined : Number(args.extractTemperature),
        groupSpeakThreshold: args.groupSpeakThreshold === undefined ? undefined : Number(args.groupSpeakThreshold),
        silentCheckMinutes: args.silentCheckMinutes === undefined ? undefined : Number(args.silentCheckMinutes),
        silentGiveUpMinutes: args.silentGiveUpMinutes === undefined ? undefined : Number(args.silentGiveUpMinutes),
        maxToolRounds: args.maxToolRounds === undefined ? undefined : Number(args.maxToolRounds),
        v3MinValue: args.v3MinValue === undefined ? undefined : Number(args.v3MinValue),
        v3MaxEvents: args.v3MaxEvents === undefined ? undefined : Number(args.v3MaxEvents),
        planDoneMemoryValue:
          args.planDoneMemoryValue === undefined ? undefined : Number(args.planDoneMemoryValue),
      });
      return {
        ok: true,
        text: [
          `回看 ${before.followUpChance} → ${next.followUpChance}（最多 ${next.followUpRounds} 遍）`,
          `说话温度 ${before.replyTemperature} → ${next.replyTemperature}`,
          `抽取温度 ${before.extractTemperature} → ${next.extractTemperature}`,
          `群聊门槛 ${before.groupSpeakThreshold} → ${next.groupSpeakThreshold}`,
          `沉默判断 ${before.silentCheckMinutes} → ${next.silentCheckMinutes} 分钟`,
          `放弃等待 ${before.silentGiveUpMinutes} → ${next.silentGiveUpMinutes} 分钟`,
          `工具轮次 ${before.maxToolRounds} → ${next.maxToolRounds}`,
          `计划完成的分 ${before.planDoneMemoryValue} → ${next.planDoneMemoryValue}`,
        ].join("，"),
      };
    },
  };
  registry.register(tool);
}
