/** 直接看抽取器对「解释小雨」这一轮会输出什么 */
import { buildMessages, parseAndValidate } from "../src/llm/extract.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";
import { openDb } from "../src/db.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");

const day = "2026-10-25";
const turns = [
  { role: "user", text: "确实，你刚刚私聊我，问我为什么叫你小雨" },
  { role: "user", text: "是因为刚开始的时候你比较呆嘛，没现在这么聪明，“糖”代表不聪明的意思，群友就在群里调侃你是小雨" },
];

const anchors = (db.prepare("SELECT name FROM anchors LIMIT 200").all() as Array<{ name: string }>).map((r) => r.name);
const messages = buildMessages(day, turns, anchors);

const adapter = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);
const raw = await adapter.complete(messages, { json: true, timeoutMs: 120_000 });

console.log("=== 模型原始输出 ===");
console.log(raw.slice(0, 1500));

const parsed = parseAndValidate(raw, day);
console.log("\n=== 解析后 " + parsed.events.length + " 条 ===");
for (const e of parsed.events) {
  console.log(`- ${e.title}`);
  console.log(`    事实：${JSON.stringify(e.keyFacts)}`);
}
db.close();
