import { readFileSync, writeFileSync } from "node:fs";

// ① tuning 增加四个可调参数
{
  const p = "src/tuning.ts";
  let s = readFileSync(p, "utf8");

  if (!s.includes("groupSpeakThreshold")) {
    s = s.replace(
      "  /** 抽取记忆时的温度：0 会写成模板，0.3 左右能写出具体的想法 */\n  extractTemperature: number;",
      [
        "  /** 抽取记忆时的温度：0 会写成模板，0.3 左右能写出具体的想法 */",
        "  extractTemperature: number;",
        "  /** 群里说话的相关性门槛：到了才回（0-1） */",
        "  groupSpeakThreshold: number;",
        "  /** 发了消息没人回，多久去判断一次（分钟） */",
        "  silentCheckMinutes: number;",
        "  /** 发了消息没人回，多久之后默认对方在忙、不再等（分钟） */",
        "  silentGiveUpMinutes: number;",
        "  /** 一次活动最多调几轮工具 */",
        "  maxToolRounds: number;",
      ].join("\n"),
    );

    s = s.replace(
      'const DEFAULTS: Tuning = { followUpChance: 0.7, followUpRounds: 3, replyTemperature: 0.9, extractTemperature: 0.3 };',
      "const DEFAULTS: Tuning = {\n  followUpChance: 0.7,\n  followUpRounds: 3,\n  replyTemperature: 0.9,\n  extractTemperature: 0.3,\n  groupSpeakThreshold: 0.6,\n  silentCheckMinutes: 3,\n  silentGiveUpMinutes: 60,\n  maxToolRounds: 20,\n};",
    );

    // 读
    s = s.replace(
      "      extractTemperature: clamp(Number(raw.extractTemperature ?? DEFAULTS.extractTemperature), 0, 1),",
      [
        "      extractTemperature: clamp(Number(raw.extractTemperature ?? DEFAULTS.extractTemperature), 0, 1),",
        "      groupSpeakThreshold: clamp(Number(raw.groupSpeakThreshold ?? DEFAULTS.groupSpeakThreshold), 0, 1),",
        "      silentCheckMinutes: Math.max(1, Math.min(120, Number(raw.silentCheckMinutes ?? DEFAULTS.silentCheckMinutes))),",
        "      silentGiveUpMinutes: Math.max(5, Math.min(1440, Number(raw.silentGiveUpMinutes ?? DEFAULTS.silentGiveUpMinutes))),",
        "      maxToolRounds: Math.max(3, Math.min(50, Number(raw.maxToolRounds ?? DEFAULTS.maxToolRounds))),",
      ].join("\n"),
    );

    // 写
    s = s.replace(
      "    extractTemperature: clamp(Number(t.extractTemperature ?? cur.extractTemperature), 0, 1),",
      [
        "    extractTemperature: clamp(Number(t.extractTemperature ?? cur.extractTemperature), 0, 1),",
        "    groupSpeakThreshold: clamp(Number(t.groupSpeakThreshold ?? cur.groupSpeakThreshold), 0, 1),",
        "    silentCheckMinutes: Math.max(1, Math.min(120, Number(t.silentCheckMinutes ?? cur.silentCheckMinutes))),",
        "    silentGiveUpMinutes: Math.max(5, Math.min(1440, Number(t.silentGiveUpMinutes ?? cur.silentGiveUpMinutes))),",
        "    maxToolRounds: Math.max(3, Math.min(50, Number(t.maxToolRounds ?? cur.maxToolRounds))),",
      ].join("\n"),
    );

    writeFileSync(p, s, "utf8");
    console.log("tuning：四个新参数已加");
  }
}

// ② 工具里暴露
{
  const p = "src/tune-tool.ts";
  let s = readFileSync(p, "utf8");

  if (!s.includes("groupSpeakThreshold")) {
    s = s.replace(
      '        extractTemperature: { type: "number", description: "抽取记忆的温度：0 写成模板，0.3 能写出具体想法" },',
      [
        '        extractTemperature: { type: "number", description: "抽取记忆的温度：0 写成模板，0.3 能写出具体想法" },',
        '        groupSpeakThreshold: { type: "number", description: "群里说话的相关性门槛 0-1：到了才回。调高更安静" },',
        '        silentCheckMinutes: { type: "integer", description: "没人回你时，多少分钟后判断一次" },',
        '        silentGiveUpMinutes: { type: "integer", description: "多少分钟后默认对方在忙、不再等" },',
        '        maxToolRounds: { type: "integer", description: "一次最多调几轮工具（3-50）" },',
      ].join("\n"),
    );

    s = s.replace(
      "        extractTemperature: args.extractTemperature === undefined ? undefined : Number(args.extractTemperature),",
      [
        "        extractTemperature: args.extractTemperature === undefined ? undefined : Number(args.extractTemperature),",
        "        groupSpeakThreshold: args.groupSpeakThreshold === undefined ? undefined : Number(args.groupSpeakThreshold),",
        "        silentCheckMinutes: args.silentCheckMinutes === undefined ? undefined : Number(args.silentCheckMinutes),",
        "        silentGiveUpMinutes: args.silentGiveUpMinutes === undefined ? undefined : Number(args.silentGiveUpMinutes),",
        "        maxToolRounds: args.maxToolRounds === undefined ? undefined : Number(args.maxToolRounds),",
      ].join("\n"),
    );

    s = s.replace(
      "        text: `回看 ${before.followUpChance} → ${next.followUpChance}，最多 ${next.followUpRounds} 遍，说话温度 ${before.replyTemperature} → ${next.replyTemperature}，抽取温度 ${before.extractTemperature} → ${next.extractTemperature}`,",
      [
        "        text: [",
        "          `回看 ${before.followUpChance} → ${next.followUpChance}（最多 ${next.followUpRounds} 遍）`,",
        "          `说话温度 ${before.replyTemperature} → ${next.replyTemperature}`,",
        "          `抽取温度 ${before.extractTemperature} → ${next.extractTemperature}`,",
        "          `群聊门槛 ${before.groupSpeakThreshold} → ${next.groupSpeakThreshold}`,",
        "          `沉默判断 ${before.silentCheckMinutes} → ${next.silentCheckMinutes} 分钟`,",
        "          `放弃等待 ${before.silentGiveUpMinutes} → ${next.silentGiveUpMinutes} 分钟`,",
        "          `工具轮次 ${before.maxToolRounds} → ${next.maxToolRounds}`,",
        "        ].join(\"，\"),",
      ].join("\n"),
    );

    writeFileSync(p, s, "utf8");
    console.log("tune-tool：四个参数已暴露");
  }
}
