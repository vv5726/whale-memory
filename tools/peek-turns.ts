import { openDb } from "../src/db.ts";
import { pendingTurns } from "../src/sleep.ts";

const db = openDb(process.argv[2] ?? "data/qq-memory.db");

const total = db.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0;
const unprocessed = pendingTurns(db);
console.log(`原始对话 ${total} 条（待整理 ${unprocessed} 条）`);

console.log("\n=== 最近 30 轮原始对话 ===");
for (const r of db.prepare("SELECT day, role, text FROM turns ORDER BY seq DESC LIMIT 30").all().reverse()) {
  const who = String(r.role) === "user" ? "本人" : "机器人";
  console.log(`[${r.day}] ${who}: ${r.text}`);
}

const events = db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0;
console.log(`\n=== 记忆库现状：${events} 条事件 ===`);
