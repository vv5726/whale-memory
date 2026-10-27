import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");

const pending = Number(db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get()?.c ?? 0);
const events = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
const typed = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE etype <> ''").get()?.c ?? 0);
console.log(`待整理 ${pending} 轮｜事件 ${events} 条｜带 etype 的 ${typed} 条｜extractV3=${cfg.extractV3}`);

if (pending === 0) {
  console.log("没有待整理的对话——她下次聊天后 3 分钟才会整理。");
  db.close();
  process.exit(0);
}

const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });
try {
  const r = await svc.sleepNow();
  console.log("整理：" + JSON.stringify(r).slice(0, 160));
} catch (err) {
  console.log("失败：" + (err instanceof Error ? err.message : String(err)));
}
svc.close();

const after = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE etype <> ''").get()?.c ?? 0);
console.log(`带 etype 的记忆：${typed} → ${after}`);

const rows = db
  .prepare("SELECT title, etype, status, memory_value FROM events WHERE etype <> '' ORDER BY ts DESC LIMIT 5")
  .all() as Array<{ title: string; etype: string; status: string; memory_value: number }>;
for (const x of rows) {
  console.log(`  【${String(x.title).slice(0, 30)}】${x.etype}/${x.status} 价值${x.memory_value}`);
}
db.close();
