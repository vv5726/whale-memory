import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

// 1) 人表：主人是 他，林溪是编的
db.exec("UPDATE people SET display_name = '他', aliases = '[]' WHERE qq_id = '10001'");
console.log("人表：10001 → 他");

// 2) 锚点：把「林溪」改名为「他」（同一个人节点，不新建）
const a = db.prepare("SELECT id, name FROM anchors WHERE name = ?").get("林溪") as { id: string; name: string } | undefined;
if (a) {
  const dup = db.prepare("SELECT id FROM anchors WHERE name = ?").get("他") as { id: string } | undefined;
  if (dup) {
    // 已经有 他 锚点：把林溪上的记忆挪过去，删掉林溪
    db.prepare("INSERT OR IGNORE INTO event_anchors (event_id, anchor_id, weight, role) SELECT event_id, ?, weight, role FROM event_anchors WHERE anchor_id = ?").run(dup.id, a.id);
    db.prepare("DELETE FROM event_anchors WHERE anchor_id = ?").run(a.id);
    db.prepare("DELETE FROM edges WHERE src = ? OR dst = ?").run(a.id, a.id);
    db.prepare("DELETE FROM anchors WHERE id = ?").run(a.id);
    console.log("锚点：林溪 并入 他");
  } else {
    db.prepare("UPDATE anchors SET name = '他' WHERE id = ?").run(a.id);
    console.log("锚点：林溪 → 他（改名）");
  }
}

// 3) 记忆正文里的「林溪」改成「他」
const events = db.prepare("SELECT id, title, detail FROM events WHERE title LIKE ? OR detail LIKE ?").all("%林溪%", "%林溪%") as Array<{
  id: string;
  title: string;
  detail: string;
}>;
for (const e of events) {
  db.prepare("UPDATE events SET title = ?, detail = ?, updated_at = ? WHERE id = ?").run(
    e.title.split("林溪").join("他"),
    e.detail.split("林溪").join("他"),
    Date.now(),
    e.id,
  );
}
console.log(`记忆：改了 ${events.length} 条里的「林溪」`);

console.log("\n现在还提到林溪的：");
const left = Number(
  db.prepare("SELECT COUNT(*) AS c FROM events WHERE title LIKE ? OR detail LIKE ?").get("%林溪%", "%林溪%")?.c ?? 0,
);
console.log(`  ${left} 条`);

const people = db.prepare("SELECT qq_id, display_name, aliases FROM people").all() as Array<{
  qq_id: string;
  display_name: string;
  aliases: string;
}>;
console.log("\n人表：");
for (const p of people) console.log(`  ${p.qq_id} → ${p.display_name}（别名 ${p.aliases}）`);

const anchors = db.prepare("SELECT name, kind FROM anchors WHERE kind = 'person'").all() as Array<{ name: string; kind: string }>;
console.log(`\nperson 锚点：${anchors.map((x) => x.name).join("、")}`);
db.close();
