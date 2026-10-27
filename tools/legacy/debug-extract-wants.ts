/** 直接看抽取模型对「要求类对话」的原始输出 */
import { buildMessages, parseAndValidate } from "../src/llm/extract.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { OllamaAdapter, OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";

const cfg = loadBotConfig();
const day = "2026-10-25";
const turns = [
  { day, role: "user" as const, text: "以后你每天只能看 20 个 B 站视频，自己挑，别乱刷" },
  { day, role: "user" as const, text: "发评论之前要先跟我说一声，别自己发" },
  { day, role: "user" as const, text: "我希望你说话短一点，别老总结我的话" },
];

const knownAnchors = ["B站", "视频额度", "评论"];
const messages = buildMessages(day, turns, knownAnchors);

console.log("=== 发给模型的 system 最后 600 字 ===");
console.log(String(messages[0]?.content ?? "").slice(-600));
console.log("\n=== 模型原始输出 ===");

const adapter =
  cfg.provider === "deepseek"
    ? new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel)
    : new OllamaAdapter(cfg.ollamaBaseUrl, cfg.ollamaModel);

const raw = await adapter.complete(messages, { json: true, timeoutMs: 120_000 });
console.log(raw.slice(0, 2000));

console.log("\n=== 解析结果 ===");
try {
  const parsed = parseAndValidate(raw, day);
  console.log(`事件 ${parsed.events.length} 条`);
  for (const e of parsed.events) {
    console.log(`- ${e.title}`);
    console.log(`    事实：${JSON.stringify(e.keyFacts)}`);
  }
} catch (err) {
  console.log("解析失败：", err instanceof Error ? err.message : String(err));
}
