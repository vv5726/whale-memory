import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

console.log("锚点挂载量 TOP 8：");
for (const r of db
  .prepare(
    "SELECT a.name, COUNT(*) AS c, SUM(CASE WHEN ea.weight >= 2 THEN 1 ELSE 0 END) AS strong FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id GROUP BY a.id ORDER BY c DESC LIMIT 8",
  )
  .all() as Array<{ name: string; c: number; strong: number }>) {
  console.log(`  ${r.name}：${r.c} 条（其中强关联 ${r.strong}）`);
}

console.log("");
const total = db.prepare("SELECT COUNT(*) AS c FROM event_anchors").get() as { c: number };
const weak = db.prepare("SELECT COUNT(*) AS c FROM event_anchors WHERE weight < 2").get() as { c: number };
console.log(`锚点关系共 ${total.c} 条，其中弱关联（weight<2）${weak.c} 条`);
db.close();
