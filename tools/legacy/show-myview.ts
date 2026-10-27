import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

const rows = db
  .prepare(
    "SELECT title, detail, day FROM events WHERE archived = 0 AND detail LIKE ? ORDER BY ts DESC LIMIT 8",
  )
  .all("%我当时想%") as Array<{ title: string; detail: string; day: string }>;

console.log(`带「我当时想」的记忆：${rows.length} 条（最近 8 条）\n`);
for (const r of rows) {
  console.log(`【${r.title}】`);
  const d = String(r.detail);
  const i = d.indexOf("〔我当时想：");
  const base = i > 0 ? d.slice(0, i) : d;
  const view = i > 0 ? d.slice(i) : "";
  console.log(`  叙述：${base.slice(0, 90)}`);
  console.log(`  ${view.slice(0, 80)}`);
  console.log("");
}
db.close();
