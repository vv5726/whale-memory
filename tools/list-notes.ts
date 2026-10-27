import { openDb } from "../src/db.ts";

const db = openDb("data/users/10001.db");
const rows = db
  .prepare("SELECT title, day FROM events WHERE context_kinds LIKE ? ORDER BY ts DESC LIMIT 12")
  .all("%own-note%") as Array<{ title: string; day: string }>;

console.log(`自己记下的记忆：${rows.length} 条`);
for (const r of rows) console.log(`  · ${r.title}`);
