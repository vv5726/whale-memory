import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { extractDayWithLlm } from "../src/llm/extract.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";
import { loadAnchorIndex } from "../src/anchors.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");
db.prepare("DELETE FROM llm_extractions").run();

const adapter = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);
const index = loadAnchorIndex(db);

const turns = [
  { id: "t1", role: "user", text: "主人说今天先别改架构了，怕越改越乱", speakerId: "10001" },
  { id: "t2", role: "assistant", text: "好。我也不想再往里加字段了。", speakerId: "" },
];

const out = await extractDayWithLlm(db, cfg, index, adapter, "2026-10-27", turns, {
  user: "他",
  assistant: "凝",
});

console.log(`抽到 ${out?.events?.length ?? 0} 条`);
for (const e of out?.events ?? []) {
  console.log(`【${e.title}】`);
  console.log(`  ${String(e.detail).slice(0, 140)}`);
}
db.close();
