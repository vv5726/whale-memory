import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");

// ① 清掉抽取缓存：让新规则真的跑
const cleared = db.prepare("DELETE FROM llm_extractions").run();
console.log(`清了 ${Number(cleared.changes ?? 0)} 条抽取缓存`);

// ② 今天的对话重新标成「没处理」
const un = db.prepare("UPDATE turns SET processed = 0 WHERE role = 'user'").run();
const un2 = db.prepare("UPDATE turns SET processed = 0").run();
console.log(`重标 ${Number(un2.changes ?? 0)} 轮（其中用户发言 ${Number(un.changes ?? 0)}）`);

const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });
const r = await svc.sleepNow();
console.log("整理：" + JSON.stringify(r).slice(0, 220));

const rows = db
  .prepare("SELECT title, detail FROM events WHERE archived = 0 ORDER BY ts DESC LIMIT 6")
  .all() as Array<{ title: string; detail: string }>;
for (const x of rows) {
  const has = String(x.detail).includes("〔我当时想：");
  console.log(`${has ? "[有想法]" : "[无]   "} ${String(x.title).slice(0, 34)}`);
}
svc.close();
db.close();
