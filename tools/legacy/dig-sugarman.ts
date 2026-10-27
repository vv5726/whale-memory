import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

console.log("=== 所有提到「小雨」的记忆 ===");
const rows = db
  .prepare("SELECT id, day, tier, title, detail, key_facts FROM events WHERE title LIKE ? OR detail LIKE ? ORDER BY ts ASC")
  .all("%小雨%", "%小雨%") as Array<{ id: string; day: string; tier: string; title: string; detail: string; key_facts: string }>;

for (const r of rows) {
  console.log(`[${r.day}][${r.tier}] ${r.title}`);
  console.log(`   正文：${String(r.detail).slice(0, 100)}`);
  console.log(`   事实：${r.key_facts}`);
}

console.log(`\n共 ${rows.length} 条`);

console.log("\n=== 原始对话里提到「小雨」的 ===");
const turns = db
  .prepare("SELECT day, role, text FROM turns WHERE text LIKE ? ORDER BY seq ASC")
  .all("%小雨%") as Array<{ day: string; role: string; text: string }>;
for (const t of turns) {
  console.log(`[${t.day}] ${t.role === "user" ? "他" : "凝"}：${t.text.slice(0, 120)}`);
}
console.log(`\n共 ${turns.length} 轮`);
