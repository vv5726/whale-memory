import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

console.log("=== 记忆里提到「值得/该不该存」的 ===");
const rows = db
  .prepare("SELECT day, title, detail FROM events WHERE detail LIKE ? OR title LIKE ? ORDER BY ts DESC LIMIT 8")
  .all("%值得%", "%值得%") as Array<{ day: string; title: string; detail: string }>;
for (const r of rows) {
  console.log(`[${r.day}] ${r.title}`);
  console.log(`    ${String(r.detail).slice(0, 140)}`);
}
if (rows.length === 0) console.log("（一条都没有）");

console.log("\n=== 手记里提到「值得存/自己判断」的 ===");
const fs = await import("node:fs");
if (fs.existsSync("data/journal")) {
  for (const f of fs.readdirSync("data/journal")) {
    const t = fs.readFileSync(`data/journal/${f}`, "utf8");
    for (const line of t.split("\n")) {
      if (/值得存|什么值得|自己判断|整理记忆/.test(line)) console.log(`  [${f}] ${line.trim().slice(0, 120)}`);
    }
  }
}
