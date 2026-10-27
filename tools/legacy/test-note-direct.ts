/** 验证：写一条手记，是否直接进记忆库 */
import { loadBotConfig } from "../src/bot/config.ts";
import { buildTools } from "../src/tools/index.ts";
import { openDb } from "../src/db.ts";

const cfg = loadBotConfig();
const db = openDb("data/users/10001.db");
const before = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);

const tools = buildTools(cfg, db);
const result = await tools.call("self_note", {
  text: "看了折叠机评测。标题喊1万次，实测500次折痕就明显加深，但亮屏几乎无感。真正让我信的是它承认「中央磁铁作用不明」——肯说没搞懂的人，别的话才敢信。",
});
console.log(`self_note → ${result.text}`);

const after = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
console.log(`记忆事件：${before} → ${after}`);

const row = db
  .prepare("SELECT title, tier, affect_summary FROM events WHERE title LIKE '%折叠%' ORDER BY ts DESC LIMIT 1")
  .get();
console.log(row ? `✓ 记忆里有了：${JSON.stringify(row)}` : "✗ 还是没有");
db.close();
