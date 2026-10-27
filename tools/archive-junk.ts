import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

// 只归档「元叙述」和「没有信息的重复」——不删，可恢复
const junkPatterns = ["%你刚刚私聊我%", "%是他在群里叫你小雨%", "%不是，是群友叫你小雨%"];

let archived = 0;
for (const p of junkPatterns) {
  const rows = db.prepare("SELECT id, title FROM events WHERE title LIKE ? OR detail LIKE ?").all(p, p) as Array<{
    id: string;
    title: string;
  }>;
  for (const r of rows) {
    // 保留那条带释义的（它有 key_facts）
    const hasFacts = db.prepare("SELECT key_facts FROM events WHERE id = ?").get(r.id) as { key_facts: string };
    if (hasFacts.key_facts && hasFacts.key_facts !== "[]") {
      console.log(`  跳过（有事实）：${r.title.slice(0, 40)}`);
      continue;
    }
    db.prepare("UPDATE events SET archived = 1 WHERE id = ?").run(r.id);
    archived += 1;
    console.log(`  归档：${r.title.slice(0, 40)}`);
  }
}

console.log(`\n归档 ${archived} 条`);
const left = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
console.log(`有效记忆：${left} 条`);
db.close();
