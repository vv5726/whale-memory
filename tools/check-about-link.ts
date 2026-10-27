import { openDb } from "../src/db.ts";
import { aboutPerson } from "../src/about-person.ts";

const db = openDb("data/memory.db");

const r = aboutPerson(db, { person: "他", content: "做记忆系统，喜欢直接给结论，不喜欢绕" });
console.log(r.text);

const rows = db
  .prepare(
    "SELECT e.title, a.name AS anchor FROM events e JOIN event_anchors ea ON ea.event_id = e.id JOIN anchors a ON a.id = ea.anchor_id WHERE e.kind = 'user' AND ea.role = 'subject'",
  )
  .all() as Array<{ title: string; anchor: string }>;

console.log(`\n挂了锚点的档案 ${rows.length} 条：`);
for (const x of rows) console.log(`  ${String(x.title).slice(0, 45)} → 锚点「${x.anchor}」`);

const onPerson = db
  .prepare(
    "SELECT e.title FROM events e JOIN event_anchors ea ON ea.event_id = e.id JOIN anchors a ON a.id = ea.anchor_id WHERE a.kind = 'person' AND e.archived = 0",
  )
  .all() as Array<{ title: string }>;

console.log(`\n挂在「人」锚点上的记忆 ${onPerson.length} 条：`);
for (const x of onPerson.slice(0, 6)) console.log(`  ${String(x.title).slice(0, 50)}`);
db.close();
