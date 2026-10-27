import { readFileSync, writeFileSync } from "node:fs";
import { openDb } from "../src/db.ts";
import { dayKey } from "../src/util.ts";

const db = openDb("data/qq-memory.db");
const today = dayKey(Date.now());

const rows = db
  .prepare("SELECT day, role, text FROM turns WHERE day = ? ORDER BY seq ASC")
  .all(today) as Array<{ day: string; role: string; text: string }>;

console.log(`今天（${today}）共 ${rows.length} 条对话：`);
for (const r of rows) console.log(`  ${r.role === "user" ? "本人" : "机器人"}: ${r.text.slice(0, 50)}`);

const lines = rows.map((r) => JSON.stringify({ day: r.day, role: r.role, text: r.text }));
writeFileSync("data/first-day.jsonl", `${lines.join("\n")}\n`, "utf8");
console.log(`\n已保存到 data/first-day.jsonl（${lines.length} 行）`);

// 顺便确认一下旧库里的东西
const events = db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0;
console.log(`旧记忆库：${events} 条事件（这些将被清掉）`);
void readFileSync;
