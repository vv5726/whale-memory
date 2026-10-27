import { openDb } from "../src/db.ts";

/** 清掉不是真人的人节点：王建国、男朋友、群友（泛指） */
const FAKE = ["王建国", "男朋友", "群友"];
const db = openDb("data/memory.db");

for (const name of FAKE) {
  const a = db.prepare("SELECT id FROM anchors WHERE name = ? AND kind = 'person'").get(name) as { id: string } | undefined;
  if (!a) {
    console.log(`${name}：没有这个人锚点`);
    continue;
  }

  // 看它挂着哪些记忆
  const evs = db
    .prepare("SELECT e.id, e.title FROM events e JOIN event_anchors ea ON ea.event_id = e.id WHERE ea.anchor_id = ?")
    .all(a.id) as Array<{ id: string; title: string }>;
  console.log(`\n${name} 挂着 ${evs.length} 条记忆：`);
  for (const e of evs) console.log(`  - ${e.title.slice(0, 50)}`);

  // 记忆正文里出现这个名字的，一起归档（多半是编的）
  for (const e of evs) {
    db.prepare("UPDATE events SET archived = 1 WHERE id = ?").run(e.id);
    console.log(`    归档：${e.title.slice(0, 40)}`);
  }

  db.prepare("DELETE FROM event_anchors WHERE anchor_id = ?").run(a.id);
  db.prepare("DELETE FROM edges WHERE src = ? OR dst = ?").run(a.id, a.id);
  db.prepare("DELETE FROM anchors WHERE id = ?").run(a.id);
  console.log(`  删除人锚点：${name}`);
}

// 「群友」这类泛指词以后不许当锚点
const generic = ["群友", "网友", "朋友", "某人", "那个人", "大家"];
let n = 0;
for (const g of generic) {
  const r = db.prepare("DELETE FROM anchors WHERE name = ?").run(g);
  n += Number(r.changes ?? 0);
}
if (n > 0) console.log(`\n顺带删掉泛指锚点 ${n} 个`);

const left = db.prepare("SELECT name FROM anchors WHERE kind = 'person' ORDER BY name").all() as Array<{ name: string }>;
const total = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
console.log(`\n剩下的人：${left.map((x) => x.name).join("、") || "（无）"}`);
console.log(`有效记忆：${total} 条`);
db.close();
