/** 验证「手记 → 记忆」这条链路：写了手记之后睡一觉，能不能变成正式记忆 */
import { loadBotConfig } from "../src/bot/config.ts";
import { buildTools } from "../src/tools/index.ts";
import { openDb } from "../src/db.ts";
import { sleepAsync } from "../src/sleep.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { withOverrides } from "../src/config.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";

const DB = "data/users/10001.db";
const cfg = loadBotConfig();
const db = openDb(DB);

const before = {
  events: Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0),
  turns: Number(db.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0),
};
console.log(`前：事件 ${before.events}，对话 ${before.turns}`);

const tools = buildTools(cfg, db);
const note = await tools.call("self_note", {
  text: "看了折叠机评测。标题喊1万次，实测500次折痕就明显加深，但亮屏几乎无感。真正让我信的是它承认「中央磁铁作用不明」——肯说没搞懂的人，别的话才敢信。",
});
console.log(`self_note → ${note.text}`);

const mid = Number(db.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0);
console.log(`写手记后对话数：${mid}（+${mid - before.turns}）`);

const memoryCfg = withOverrides(DEFAULT_CONFIG, {
  contextBudgetTokens: cfg.contextBudgetTokens,
  extractor: "llm",
  llmBaseUrl: cfg.deepseekBaseUrl,
  llmModel: cfg.deepseekModel,
});
const adapter = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);
const stats = await sleepAsync(db, memoryCfg, { nowTs: Date.now() }, adapter);
console.log(`睡眠完成：LLM 抽到 ${stats?.llm?.inserted ?? 0} 条`);

const after = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
console.log(`后：事件 ${after}（+${after - before.events}）`);

console.log("\n=== 和「折叠」有关的记忆 ===");
const rows = db.prepare("SELECT title, key_facts FROM events WHERE detail LIKE '%折叠%' OR title LIKE '%折叠%'").all();
console.log(rows.length > 0 ? rows.map((r) => `- ${r.title}\n    ${r.key_facts}`).join("\n") : "（还是没有）");
db.close();
