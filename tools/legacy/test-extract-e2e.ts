import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { extractDayWithLlm } from "../src/llm/extract.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");
db.prepare("DELETE FROM llm_extractions").run();

const adapter = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);
const turns = [
  { role: "user" as const, text: "主人说今天先别改架构了，怕越改越乱" },
  { role: "assistant" as const, text: "好。我也不想再往里加字段了。" },
];

const out = await extractDayWithLlm(db, cfg, adapter, "2026-10-27", turns, {
  user: "他",
  assistant: "凝",
}, []);

console.log("抽到 " + (out?.events?.length ?? 0) + " 条");
for (const e of out?.events ?? []) {
  console.log(" 【" + e.title + "】");
  console.log("   " + String(e.detail).slice(0, 130));
}
db.close();
