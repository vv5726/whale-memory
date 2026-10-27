import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

console.log("被归档的「小雨」定义，归档理由是什么：");
const rows = db
  .prepare(
    "SELECT title, verdict, verdict_reason FROM events WHERE archived = 1 AND (title LIKE ? OR detail LIKE ?)",
  )
  .all("%小雨%", "%小雨%") as Array<{ title: string; verdict: string; verdict_reason: string }>;

for (const r of rows) {
  console.log(`  「${String(r.title).slice(0, 34)}」`);
  console.log(`     verdict=${r.verdict || "(空)"}  理由=${String(r.verdict_reason).slice(0, 60) || "(空)"}`);
}

console.log("");
console.log("归档总数按 verdict 分布：");
for (const r of db
  .prepare("SELECT verdict, COUNT(*) AS c FROM events WHERE archived = 1 GROUP BY verdict ORDER BY c DESC")
  .all() as Array<{ verdict: string; c: number }>) {
  console.log(`  ${r.verdict || "(空)"}：${r.c} 条`);
}
db.close();
