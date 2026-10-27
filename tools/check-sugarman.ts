import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/memory.db");
const rows = db
  .prepare("SELECT title, detail, key_facts FROM events WHERE archived = 0 AND (title LIKE ? OR detail LIKE ?) ORDER BY ts DESC")
  .all("%小雨%", "%小雨%") as Array<{ title: string; detail: string; key_facts: string }>;

console.log(`=== 现在关于「小雨」的记忆（${rows.length} 条）`);
for (const r of rows) {
  console.log(`- ${r.title}`);
  console.log(`  ${String(r.detail).slice(0, 110)}`);
  console.log(`  事实：${r.key_facts}`);
}
db.close();
