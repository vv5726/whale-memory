import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

const total = Number(db.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0);
const users = Number(db.prepare("SELECT COUNT(*) AS c FROM turns WHERE role = 'user'").get()?.c ?? 0);
console.log(`turns 总数 ${total}，其中用户发言 ${users}`);

const rows = db.prepare("SELECT role, text, ts FROM turns ORDER BY seq DESC LIMIT 6").all() as Array<{
  role: string;
  text: string;
  ts: number;
}>;
console.log("最近 6 条：");
for (const r of rows) {
  const t = new Date(Number(r.ts)).toLocaleString("zh-CN");
  console.log(`  [${t}] ${r.role === "user" ? "他" : "凝"}：${String(r.text).replace(/\s+/g, " ").slice(0, 40)}`);
}

const days = db.prepare("SELECT day, COUNT(*) AS c FROM turns GROUP BY day ORDER BY day DESC LIMIT 5").all() as Array<{
  day: string;
  c: number;
}>;
console.log("按天：");
for (const d of days) console.log(`  ${d.day}：${d.c} 轮`);

db.close();
