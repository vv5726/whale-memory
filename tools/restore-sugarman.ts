import { openDb } from "../src/db.ts";

/** 「小雨 = 群友调侃凝…」是真事，只是它提到了「群友」这个词，被误归档了。恢复。 */
const db = openDb("data/memory.db");

const rows = db
  .prepare("SELECT id, title, archived FROM events WHERE title LIKE ? OR detail LIKE ?")
  .all("%小雨%", "%小雨%") as Array<{ id: string; title: string; archived: number }>;

console.log("提到「小雨」的记忆：");
for (const r of rows) {
  const flag = Number(r.archived) === 1 ? "已归档" : "有效";
  console.log(`  [${flag}] ${r.title.slice(0, 50)}`);
}

// 把讲定义的那条恢复（有「=」或「调侃」的那条）
for (const r of rows) {
  if (Number(r.archived) === 1 && /调侃|群友/.test(r.title)) {
    db.prepare("UPDATE events SET archived = 0 WHERE id = ?").run(r.id);
    console.log(`\n恢复：${r.title.slice(0, 50)}`);
  }
}

const total = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
console.log(`\n有效记忆：${total} 条`);
db.close();
