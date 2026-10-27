import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

console.log("=== 最近 6 条记忆 ===");
const rows = db
  .prepare("SELECT title, key_facts, ts FROM events ORDER BY ts DESC LIMIT 6")
  .all() as Array<{ title: string; key_facts: string; ts: number }>;
for (const r of rows) {
  const t = new Date(Number(r.ts)).toTimeString().slice(0, 5);
  console.log(`[${t}] ${r.title}`);
  console.log(`       事实：${r.key_facts}`);
}

const pending = Number(db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get()?.c ?? 0);
console.log(`\n待整理：${pending} 条`);
