import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

console.log("① 锚点里有没有「小雨」");
const anchors = db.prepare("SELECT id, name, kind FROM anchors WHERE name LIKE ?").all("%小糖%") as Array<{
  id: string;
  name: string;
  kind: string;
}>;
console.log(`  匹配 ${anchors.length} 个：${anchors.map((a) => a.name).join("、") || "无"}`);

console.log("");
console.log("② 挂在这个锚点上的记忆");
for (const a of anchors) {
  const evs = db
    .prepare("SELECT e.title FROM events e JOIN event_anchors ea ON ea.event_id = e.id WHERE ea.anchor_id = ? AND e.archived = 0 LIMIT 3")
    .all(a.id) as Array<{ title: string }>;
  console.log(`  「${a.name}」→ ${evs.length} 条证据：${evs.map((e) => String(e.title).slice(0, 30)).join(" / ")}`);
}

console.log("");
console.log("③ 正文里提到小雨的记忆");
const byText = db
  .prepare("SELECT title FROM events WHERE archived = 0 AND detail LIKE ? LIMIT 5")
  .all("%小雨%") as Array<{ title: string }>;
console.log(`  ${byText.length} 条：${byText.map((e) => String(e.title).slice(0, 32)).join(" / ")}`);

db.close();
