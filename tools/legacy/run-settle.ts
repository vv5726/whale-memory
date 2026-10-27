import { openDb } from "../src/db.ts";
import { settle } from "../src/settle.ts";

const db = openDb("data/memory.db");
const r = settle(db);

const one = (sql: string): number => Number(db.prepare(sql).get()?.c ?? 0);
console.log(`重复 ${r.duplicate} 条，没结论 ${r.inconclusive} 条`);
console.log(`有效记忆：${one("SELECT COUNT(*) AS c FROM events WHERE archived = 0")} 条`);
console.log(`分层：${JSON.stringify(db.prepare("SELECT tier, COUNT(*) AS c FROM events WHERE archived = 0 GROUP BY tier").all())}`);
console.log(`裁定：${JSON.stringify(db.prepare("SELECT verdict, COUNT(*) AS c FROM events WHERE archived = 0 GROUP BY verdict").all())}`);
db.close();
