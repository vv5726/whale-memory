import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });

const r = await svc.sleepNow();
console.log("整理结果：" + JSON.stringify(r).slice(0, 200));

const db = (svc as unknown as { db: import("node:sqlite").DatabaseSync }).db;
const rows = db
  .prepare("SELECT title, detail FROM events WHERE archived = 0 ORDER BY ts DESC LIMIT 5")
  .all() as Array<{ title: string; detail: string }>;

for (const x of rows) {
  const has = String(x.detail).includes("〔我当时想：");
  console.log(`${has ? "[有想法]" : "[无]"} ${String(x.title).slice(0, 36)}`);
  if (has) console.log(`      ${String(x.detail).slice(-60)}`);
}
svc.close();
