import { openDb } from "../src/db.ts";

/**
 * 按「每条记忆留几个锚点」清理，而不是按权重大小删。
 *
 * 规则（主人定的）：
 *   角色锚点（kind = person）  全部保留
 *   其他锚点                   最多留 3 个（按权重，权重相同按最早挂的）
 */
const db = openDb("data/memory.db");

const before = db.prepare("SELECT COUNT(*) AS c FROM event_anchors").get() as { c: number };
console.log(`清理前：关系 ${before.c} 条`);

const events = db
  .prepare("SELECT id FROM events WHERE archived = 0")
  .all() as Array<{ id: string }>;

let removed = 0;

for (const e of events) {
  const rows = db
    .prepare(
      `SELECT ea.anchor_id AS aid, ea.weight AS w, a.kind AS kind, ea.rowid AS rid
       FROM event_anchors ea JOIN anchors a ON a.id = ea.anchor_id
       WHERE ea.event_id = ?`,
    )
    .all(e.id) as Array<{ aid: string; w: number; kind: string; rid: number }>;

  const persons = rows.filter((r) => r.kind === "person");
  const others = rows
    .filter((r) => r.kind !== "person")
    .sort((a, b) => Number(b.w) - Number(a.w) || Number(a.rid) - Number(b.rid));

  const keepOthers = others.slice(0, 3);
  const drop = others.slice(3);

  for (const d of drop) {
    db.prepare("DELETE FROM event_anchors WHERE event_id = ? AND anchor_id = ?").run(e.id, d.aid);
    removed += 1;
  }

  // 保证每条至少有一个锚点：如果非角色全删光、也没有角色锚点，就留下权重最高的那个
  const left = persons.length + keepOthers.length;
  if (left === 0 && others.length > 0) {
    const first = others[0]!;
    // 刚才删掉了，补回来
    db.prepare("INSERT OR IGNORE INTO event_anchors(event_id, anchor_id, weight) VALUES(?,?,?)").run(e.id, first.aid, first.w);
    removed -= 1;
  }
}

const after = db.prepare("SELECT COUNT(*) AS c FROM event_anchors").get() as { c: number };
console.log(`清理后：关系 ${after.c} 条（删了 ${removed} 条）`);

console.log("");
console.log("锚点挂载量 TOP 8：");
for (const r of db
  .prepare(
    "SELECT a.name, COUNT(*) AS c FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id GROUP BY a.id ORDER BY c DESC LIMIT 8",
  )
  .all() as Array<{ name: string; c: number }>) {
  console.log(`  ${r.name}：${r.c} 条`);
}

const orphan = db
  .prepare(
    "SELECT COUNT(*) AS c FROM events e WHERE e.archived = 0 AND NOT EXISTS (SELECT 1 FROM event_anchors ea WHERE ea.event_id = e.id)",
  )
  .get() as { c: number };
console.log("");
console.log(`没有任何锚点的记忆：${orphan.c} 条`);
db.close();
