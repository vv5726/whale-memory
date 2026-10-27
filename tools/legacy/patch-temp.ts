import { readFileSync, writeFileSync } from "node:fs";

// ① tuning 加温度
{
  const p = "src/tuning.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace(
    "  /** 整体：最多回头看几遍 */\n  followUpRounds: number;",
    [
      "  /** 整体：最多回头看几遍 */",
      "  followUpRounds: number;",
      "  /** 说话的温度：0 完全确定（每次都一样），1 很跳。抽取不用这个值 */",
      "  replyTemperature: number;",
    ].join("\n"),
  );
  s = s.replace(
    'const DEFAULTS: Tuning = { followUpChance: 0.6, followUpRounds: 3 };',
    'const DEFAULTS: Tuning = { followUpChance: 0.6, followUpRounds: 3, replyTemperature: 0.9 };',
  );
  s = s.replace(
    "      followUpRounds: Math.max(1, Math.min(5, Number(raw.followUpRounds ?? DEFAULTS.followUpRounds))),",
    [
      "      followUpRounds: Math.max(1, Math.min(5, Number(raw.followUpRounds ?? DEFAULTS.followUpRounds))),",
      "      replyTemperature: clamp(Number(raw.replyTemperature ?? DEFAULTS.replyTemperature), 0, 1.5),",
    ].join("\n"),
  );
  s = s.replace(
    "    followUpRounds: Math.max(1, Math.min(5, Number(t.followUpRounds ?? cur.followUpRounds))),",
    [
      "    followUpRounds: Math.max(1, Math.min(5, Number(t.followUpRounds ?? cur.followUpRounds))),",
      "    replyTemperature: clamp(Number(t.replyTemperature ?? cur.replyTemperature), 0, 1.5),",
    ].join("\n"),
  );
  writeFileSync(p, s, "utf8");
  console.log("tuning：replyTemperature 已加");
}

// ② toolchat 接受温度
{
  const p = "src/llm/toolchat.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace("  model: string;", "  model: string;\n  /** 说话的温度；不传就用 0 */\n  temperature?: number;");
  s = s.replace('        body: JSON.stringify({ model: cfg.model, messages: history, tools, too', '        body: JSON.stringify({ model: cfg.model, messages: history, tools, too');
  s = s.replace("      temperature: 0,", "      temperature: cfg.temperature ?? 0,");
  writeFileSync(p, s, "utf8");
  console.log("toolchat：温度可传");
}

// ③ service：回话用 tuning 的温度
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace(
    "          model: this.cfg.deepseekModel,",
    "          model: this.cfg.deepseekModel,\n          temperature: loadTuning(this.cfg.dataDir).replyTemperature,",
  );
  writeFileSync(p, s, "utf8");
  console.log("service：回话带上温度");
}

// ④ 工具里能调温度
{
  const p = "src/tune-tool.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace(
    '        followUpRounds: { type: "integer", description: "1-5" },',
    '        followUpRounds: { type: "integer", description: "1-5" },\n        replyTemperature: { type: "number", description: "说话的温度：0 每次都一样，0.9 有点变化，1.2 很跳" },',
  );
  s = s.replace(
    "        followUpRounds: args.followUpRounds === undefined ? undefined : Number(args.followUpRounds),",
    "        followUpRounds: args.followUpRounds === undefined ? undefined : Number(args.followUpRounds),\n        replyTemperature: args.replyTemperature === undefined ? undefined : Number(args.replyTemperature),",
  );
  s = s.replace(
    "      return {\n        ok: true,\n        text: `回看的概率 ${before.followUpChance} → ${next.followUpChance}，最多看 ${next.followUpRounds} 遍`,\n      };",
    "      return {\n        ok: true,\n        text: `回看 ${before.followUpChance} → ${next.followUpChance}，最多 ${next.followUpRounds} 遍，温度 ${before.replyTemperature} → ${next.replyTemperature}`,\n      };",
  );
  writeFileSync(p, s, "utf8");
  console.log("tool：温度可调");
}
