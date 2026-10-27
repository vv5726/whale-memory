import { readFileSync, writeFileSync } from "node:fs";
import { openDb } from "../src/db.ts";

// ① 关掉 memory_dedup
const p = "src/tools/index.ts";
let s = readFileSync(p, "utf8");
const before = s;
s = s.replace(/^.*registerDedupTool\(registry.*$/gm, "  // 去重已停用：不再做破坏性归档");
if (s !== before) {
  writeFileSync(p, s, "utf8");
  console.log("① memory_dedup 已停用");
} else {
  const line = s.split("\n").find((l) => l.includes("registerDedupTool"));
  console.log("① 没匹配到，实际那行是：" + String(line).trim().slice(0, 80));
}

// ② 看数据现状
const db = openDb("data/memory.db");
const live = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
const merged = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE verdict = 'merged'").get()?.c ?? 0);
const turns = Number(db.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0);
console.log(`② 有效记忆 ${live} 条｜合并归档 ${merged} 条｜对话 ${turns} 轮`);
db.close();
