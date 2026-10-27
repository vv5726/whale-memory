import { openDb } from "../src/db.ts";
import { DatabaseSync } from "node:sqlite";

const cur = openDb("data/memory.db");
const curLive = Number(cur.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
const merged = Number(cur.prepare("SELECT COUNT(*) AS c FROM events WHERE verdict = 'merged'").get()?.c ?? 0);
console.log(`现在：有效 ${curLive} 条，其中被合并归档 ${merged} 条`);
cur.close();

const bak = new DatabaseSync("data/memory-before-merge-131825.db", { readOnly: true });
const bakLive = Number(bak.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
const bakTurns = Number(bak.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0);
bak.close();

const curTurns = (() => {
  const d = openDb("data/memory.db");
  const n = Number(d.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0);
  d.close();
  return n;
})();

console.log(`合并前备份：有效 ${bakLive} 条，对话 ${bakTurns} 轮`);
console.log(`现在对话：${curTurns} 轮`);
console.log("");
console.log(`回滚会丢掉 ${curTurns - bakTurns} 轮对话记录`);
