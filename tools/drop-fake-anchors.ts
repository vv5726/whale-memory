import { openDb } from "../src/db.ts";

/**
 * 删掉「一条记忆都没挂」的锚点。
 *
 * 这些是早期用 --seed 灌进去的演示锚点（妈妈、医院、甲状腺手术、还钱…），
 * 现实里没发生过。它们不挂任何记忆，删掉不会丢东西；留着只会让检索时
 * 把假的人名当真线索。
 */
const db = openDb("data/memory.db");

const lonely = db
  .prepare(
    `SELECT a.id, a.name, a.kind FROM anchors a
     LEFT JOIN event_anchors ea ON ea.anchor_id = a.id
     WHERE ea.event_id IS NULL`,
  )
  .all() as Array<{ id: string; name: string; kind: string }>;

if (lonely.length === 0) {
  console.log("没有孤立锚点");
  process.exit(0);
}

console.log("将要删除（没有任何记忆挂在上面的）：");
for (const a of lonely) console.log(`  ${a.name}（${a.kind ?? "?"}）`);

// 先删关系边，再删锚点
let edges = 0;
for (const a of lonely) {
  const r = db.prepare("DELETE FROM edges WHERE src = ? OR dst = ?").run(a.id, a.id);
  edges += Number(r.changes ?? 0);
  db.prepare("DELETE FROM anchor_aliases WHERE anchor_id = ?").run(a.id);
  db.prepare("DELETE FROM anchors WHERE id = ?").run(a.id);
}

const left = Number(db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c ?? 0);
const leftEdges = Number(db.prepare("SELECT COUNT(*) AS c FROM edges").get()?.c ?? 0);
console.log(`\n删除 ${lonely.length} 个锚点、${edges} 条关系`);
console.log(`剩下：${left} 个锚点，${leftEdges} 条关系`);

const remaining = db.prepare("SELECT name FROM anchors ORDER BY name").all() as Array<{ name: string }>;
console.log(`剩下的锚点：${remaining.map((r) => r.name).join("、")}`);
db.close();
