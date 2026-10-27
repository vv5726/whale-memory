/**
 * 清掉所有派生数据（事件/锚点/边/冷存储），保留原始对话，然后用指定后端重新抽一遍。
 *
 * 用法：node tools/relearn.ts [db路径]
 */
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { openDb } from "../src/db.ts";

const path = process.argv[2] ?? "data/users/10001.db";
const db = openDb(path);

db.exec(`
  DELETE FROM event_fts;
  DELETE FROM event_anchors;
  DELETE FROM edges;
  DELETE FROM anchor_aliases;
  DELETE FROM anchors;
  DELETE FROM cold_archive;
  DELETE FROM llm_extractions;
  DELETE FROM events;
  DELETE FROM mood_state;
  UPDATE turns SET processed = 0;
`);

const turns = Number(db.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0);
console.log(`已清空派生数据，保留 ${turns} 条原始对话\n`);

const cfgBase = loadBotConfig();
// 关键：把库路径指到我们清的那个库，否则服务会在默认路径上另开一个空库
const cfg = { ...cfgBase, memoryDb: path };
console.log(`抽取后端：${cfg.provider === "deepseek" ? `DeepSeek ${cfg.deepseekModel}` : `本地 ${cfg.ollamaModel}`}`);

const svc = new BotService(cfg);
const stats = await svc.sleepNow();
svc.close();

console.log(`\n抽取结果：${stats?.llm?.inserted ?? 0} 条事件　新锚点 ${stats?.llm?.newAnchors ?? 0}　退回启发式 ${stats?.llm?.failed ?? 0} 天`);
console.log(`耗时 ${((stats?.llm?.elapsedMs ?? 0) / 1000).toFixed(1)}s　占用 ${stats?.totalTokens ?? 0} token\n`);

console.log("=== 它记住的事 ===");
for (const r of db.prepare("SELECT tier, title, affect_summary, key_facts, mentions FROM events ORDER BY ts").all()) {
  console.log(`- [${r.tier}] ${r.title}`);
  console.log(`    感受：${r.affect_summary}`);
  console.log(`    事实：${r.key_facts}　提及 ${r.mentions} 次`);
}

console.log("\n=== 锚点 ===");
const anchors = db.prepare("SELECT name, kind FROM anchors ORDER BY kind, name").all();
console.log(anchors.length > 0 ? anchors.map((a) => `${a.name}(${a.kind})`).join("、") : "（无）");
db.close();
