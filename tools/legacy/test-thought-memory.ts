import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { AutonomyLoop } from "../src/bot/autonomy.ts";
import { openDb } from "../src/db.ts";

const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });
const loop = new AutonomyLoop(cfg, svc, () => {});

const before = Number(
  openDb("data/memory.db").prepare("SELECT COUNT(*) AS c FROM events WHERE context_kinds LIKE '%thought%'").get()?.c ?? 0,
);

const result = await loop.thinkOnce();
console.log(`走神结果：${result.thought ? "想了" : "没想"} — ${result.reason}`);
if (result.text) console.log(`说出来：${result.text.slice(0, 80)}`);

const db = openDb("data/memory.db");
const after = Number(
  db.prepare("SELECT COUNT(*) AS c FROM events WHERE context_kinds LIKE '%thought%'").get()?.c ?? 0,
);
console.log(`走神记忆：${before} → ${after} 条`);

const rows = db
  .prepare("SELECT title, detail FROM events WHERE context_kinds LIKE '%thought%' ORDER BY ts DESC LIMIT 2")
  .all() as Array<{ title: string; detail: string }>;
for (const r of rows) {
  console.log(`  ${r.title}`);
  console.log(`     ${String(r.detail).slice(0, 100)}`);
}
svc.close();
