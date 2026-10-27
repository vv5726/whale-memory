import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

const rows = db
  .prepare("SELECT title, detail FROM events WHERE archived = 0 AND detail LIKE ? ORDER BY ts DESC LIMIT 3")
  .all("%我当时想%") as Array<{ title: string; detail: string }>;

console.log(`带「我当时想」的有效记忆 ${rows.length} 条（看最近 3 条）：`);
for (const r of rows) {
  console.log("");
  console.log(`【${String(r.title).slice(0, 30)}】`);
  const d = String(r.detail);
  console.log(`  正文：${d.slice(0, 70)}…`);
  const v = d.slice(d.indexOf("〔我当时想："));
  console.log(`  想法：${v.slice(0, 150)}`);
}

const total = db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get() as { c: number };
const withView = db
  .prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND detail LIKE ?")
  .get("%我当时想%") as { c: number };
console.log("");
console.log(`有效 ${total.c} 条，其中带想法 ${withView.c} 条`);
db.close();
