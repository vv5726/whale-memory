import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

console.log("① 归档里有没有「小雨」的定义");
const arch = db
  .prepare("SELECT title, detail, verdict, verdict_reason, archived FROM events WHERE detail LIKE ? OR title LIKE ? ORDER BY archived")
  .all("%小雨%", "%小雨%") as Array<{
  title: string;
  detail: string;
  verdict: string;
  verdict_reason: string;
  archived: number;
}>;

for (const r of arch) {
  const hasDef = /绰号|糖=不聪明|呆呆的|群友起的/.test(r.detail + r.title);
  console.log(`  [${Number(r.archived) === 1 ? "归档" : "有效"}] ${hasDef ? "★定义" : "　　 "} ${String(r.title).slice(0, 40)}`);
  if (Number(r.archived) === 1 && hasDef) {
    console.log(`      归档理由：${r.verdict} / ${String(r.verdict_reason).slice(0, 50)}`);
    console.log(`      正文：${String(r.detail).slice(0, 100)}`);
  }
}
db.close();
