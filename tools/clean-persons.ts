import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

console.log("person 锚点挂着多少记忆：");
const rows = db
  .prepare(
    "SELECT a.id, a.name, COUNT(ea.event_id) AS c FROM anchors a LEFT JOIN event_anchors ea ON ea.anchor_id = a.id WHERE a.kind = 'person' GROUP BY a.id ORDER BY c DESC",
  )
  .all() as Array<{ id: string; name: string; c: number }>;
for (const r of rows) console.log(`  ${r.name} → ${r.c} 条`);

// 一条记忆都没挂的，和假数据一样处理：删掉
const lonely = rows.filter((r) => Number(r.c) === 0);
for (const r of lonely) {
  db.prepare("DELETE FROM event_anchors WHERE anchor_id = ?").run(r.id);
  db.prepare("DELETE FROM edges WHERE src = ? OR dst = ?").run(r.id, r.id);
  db.prepare("DELETE FROM anchors WHERE id = ?").run(r.id);
  console.log(`  删除空的人锚点：${r.name}`);
}
console.log(`\n剩下 person 锚点：${Number(db.prepare("SELECT COUNT(*) AS c FROM anchors WHERE kind='person'").get()?.c ?? 0)} 个`);
db.close();
