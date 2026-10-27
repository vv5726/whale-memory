import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const rows = db
  .prepare("SELECT title, detail FROM events WHERE archived = 0 ORDER BY ts DESC LIMIT 3")
  .all() as Array<{ title: string; detail: string }>;

for (const r of rows) {
  console.log(`【${String(r.title).slice(0, 30)}】`);
  console.log(`  ${String(r.detail).slice(0, 150)}`);
}

const n = Number(
  db.prepare("SELECT COUNT(*) AS c FROM events WHERE detail LIKE ?").get("%我当时想%")?.c ?? 0,
);
console.log(`带〔我当时想〕的记忆：${n} 条 / 共 ${Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0)} 条`);
db.close();
