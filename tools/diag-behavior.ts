import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

console.log("=== ① 它自己存的记忆，有没有锚点 ===");
const notes = db
  .prepare("SELECT id, title FROM events WHERE context_kinds LIKE '%own-note%' AND archived = 0")
  .all() as Array<{ id: string; title: string }>;
console.log(`自己存的记忆：${notes.length} 条`);
let noteWithAnchor = 0;
for (const n of notes) {
  const c = db.prepare("SELECT COUNT(*) AS c FROM event_anchors WHERE event_id = ?").get(n.id) as { c: number };
  if (Number(c.c) > 0) noteWithAnchor += 1;
}
console.log(`其中挂了锚点的：${noteWithAnchor} 条`);

console.log("\n=== ② 全部记忆的锚点覆盖 ===");
const total = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
const withAnchor = Number(
  db.prepare("SELECT COUNT(*) AS c FROM events e WHERE archived = 0 AND EXISTS (SELECT 1 FROM event_anchors ea WHERE ea.event_id = e.id)")
    .get()?.c ?? 0,
);
console.log(`记忆 ${total} 条，有锚点的 ${withAnchor} 条，孤立的 ${total - withAnchor} 条`);

console.log("\n=== ③ 那 114 条是哪来的（历史上有过吗）===");
const allEvents = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
const archived = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 1").get()?.c ?? 0);
console.log(`全部记忆（含归档）：${allEvents} 条，其中归档 ${archived} 条`);

console.log("\n=== ④ 自主发出的消息有没有进对话历史 ===");
const autonomous = db
  .prepare("SELECT COUNT(*) AS c FROM turns WHERE role = 'assistant' AND text LIKE '%情绪%'")
  .get() as { c: number };
console.log(`（检测用）对话表 assistant 条数：${Number(db.prepare("SELECT COUNT(*) AS c FROM turns WHERE role='assistant'").get()?.c ?? 0)}`);
console.log(`（检测用）对话表 user 条数：${Number(db.prepare("SELECT COUNT(*) AS c FROM turns WHERE role='user'").get()?.c ?? 0)}`);

db.close();
