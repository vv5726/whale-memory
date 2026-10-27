import { openDb } from "../src/db.ts";
import { recordOwnNote } from "../src/notes.ts";

const db = openDb("data/memory.db");

const rows = db
  .prepare("SELECT id, title, detail, archived FROM events WHERE title LIKE ? OR detail LIKE ?")
  .all("%小雨%", "%小雨%") as Array<{ id: string; title: string; detail: string; archived: number }>;

console.log(`提到「小雨」的记忆 ${rows.length} 条：`);
let hasDefinition = false;
for (const r of rows) {
  const flag = Number(r.archived) === 1 ? "归档" : "有效";
  console.log(`  [${flag}] ${r.title.slice(0, 50)}`);
  if (/小雨\s*=/.test(r.title) && Number(r.archived) === 0) hasDefinition = true;
}

if (!hasDefinition) {
  const r = recordOwnNote(
    db,
    "小雨 = 群友给凝起的绰号。起因是凝刚出来的时候比较呆、不够聪明，「糖」就是傻的意思，群友在群里这么调侃它。",
    Date.now(),
  );
  console.log(`\n没有可用的定义，已补一条：${r.title}`);
}

// 把几条元叙述归档（它们不是事，是聊这件事的过程）
const junk = db
  .prepare("SELECT id, title FROM events WHERE archived = 0 AND (title LIKE ? OR title LIKE ? OR title LIKE ?)")
  .all("%小雨是什么%", "%是群友叫你小雨%", "%一个问题记两个版本%") as Array<{ id: string; title: string }>;
for (const j of junk) {
  db.prepare("UPDATE events SET archived = 1 WHERE id = ?").run(j.id);
  console.log(`归档元叙述：${j.title.slice(0, 40)}`);
}

console.log(`\n有效记忆：${Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0)} 条`);
db.close();
