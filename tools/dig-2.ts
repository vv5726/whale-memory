import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

const r = db
  .prepare("SELECT day, processed, text, role FROM turns WHERE text LIKE ? OR text LIKE ? ORDER BY seq DESC LIMIT 5")
  .all("%代表%", "%比较呆%") as Array<{ day: string; processed: number; text: string; role: string }>;

console.log("=== 解释「小雨」的那几轮 ===");
for (const x of r) {
  console.log(`processed=${x.processed}  [${x.day}] ${x.role === "user" ? "他" : "凝"}：${String(x.text).slice(0, 90)}`);
}

const pending = Number(db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get()?.c ?? 0);
console.log(`\n当前待整理：${pending} 条`);
