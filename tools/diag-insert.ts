import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");

const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'events'").get() as { sql: string };
const notNull = [...String(schema.sql).matchAll(/(\w+)\s+TEXT NOT NULL([^,]*)/g)].map((m) => `${m[1]}${m[2].includes("DEFAULT") ? "(有默认)" : "(无默认)"}`);
console.log("NOT NULL 且没有默认值的列：" + notNull.filter((x) => x.includes("无默认")).join("、"));

const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });
const before = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
db.prepare("UPDATE turns SET processed = 0 WHERE role = 'user'").run();

try {
  const out = await svc.sleepNow();
  console.log("整理成功：" + JSON.stringify(out).slice(0, 100));
} catch (err) {
  console.log("整理失败：" + (err instanceof Error ? err.message : String(err)));
}
const after = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
console.log(`记忆 ${before} → ${after}`);
svc.close();
db.close();
