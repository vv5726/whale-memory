import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const rows = db
  .prepare("SELECT title, detail, context_kinds FROM events WHERE context_kinds LIKE '%thought%' ORDER BY ts DESC LIMIT 4")
  .all() as Array<{ title: string; detail: string; context_kinds: string }>;

console.log(`走神记忆：${rows.length} 条`);
for (const r of rows) {
  console.log(`  ${r.title}`);
  console.log(`     ${String(r.detail).slice(0, 90)}`);
}
db.close();
