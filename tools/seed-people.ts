import { openDb } from "../src/db.ts";
import { addAlias, ensurePerson, listPeople } from "../src/people.ts";

const db = openDb("data/memory.db");

// 主人：QQ 10001，昵称「林溪」
ensurePerson(db, 10001, "林溪");
addAlias(db, 10001, "本人");

console.log("已知的人：");
for (const p of listPeople(db)) {
  console.log(`  ${p.qqId} → ${p.name}　别名 ${JSON.stringify(p.aliases)}`);
}

// 把「林溪」这个锚点和他的人节点合并（如果之前抽出来的是普通 person 锚点）
const person = ensurePerson(db, 10001, "林溪")!;
const loose = db.prepare("SELECT id, name FROM anchors WHERE name = ? AND id <> ?").all("林溪", person.anchorId) as Array<{
  id: string;
  name: string;
}>;
for (const a of loose) {
  // 把挂在旧锚点上的记忆挪到人节点上，再删旧锚点
  db.prepare("INSERT OR IGNORE INTO event_anchors (event_id, anchor_id, weight) SELECT event_id, ?, weight FROM event_anchors WHERE anchor_id = ?").run(
    person.anchorId,
    a.id,
  );
  db.prepare("DELETE FROM event_anchors WHERE anchor_id = ?").run(a.id);
  db.prepare("DELETE FROM edges WHERE src = ? OR dst = ?").run(a.id, a.id);
  db.prepare("DELETE FROM anchors WHERE id = ?").run(a.id);
  console.log(`  合并旧锚点「${a.name}」→ 人节点`);
}

console.log(`\n锚点总数：${Number(db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c ?? 0)}`);
console.log(`人节点：${Number(db.prepare("SELECT COUNT(*) AS c FROM anchors WHERE kind = 'person'").get()?.c ?? 0)}`);
db.close();
