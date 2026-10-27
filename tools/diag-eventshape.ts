import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

const one = (sql: string, ...p: unknown[]): number =>
  Number(db.prepare(sql).get(...(p as never[]))?.c ?? 0);

const total = one("SELECT COUNT(*) AS c FROM events WHERE archived = 0");
const cause = one("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND cause IS NOT NULL AND length(cause) > 0");
const effect = one("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND effect IS NOT NULL AND length(effect) > 0");
const core = one(
  "SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND core_fragment IS NOT NULL AND length(core_fragment) > 0",
);
const avg = Number(
  (db.prepare("SELECT AVG(length(detail)) AS a FROM events WHERE archived = 0").get() as { a: number } | undefined)?.a ?? 0,
);

console.log(`记忆 ${total} 条`);
console.log(`填了起因：${cause} 条（${Math.round((cause / total) * 100)}%）`);
console.log(`填了结果：${effect} 条（${Math.round((effect / total) * 100)}%）`);
console.log(`有核心片段：${core} 条（${Math.round((core / total) * 100)}%）`);
console.log(`正文平均：${Math.round(avg)} 字`);

console.log("\n随便看 3 条：");
const rows = db.prepare("SELECT title, detail FROM events WHERE archived = 0 ORDER BY ts DESC LIMIT 3").all() as Array<{
  title: string;
  detail: string;
}>;
for (const r of rows) {
  console.log(`  ${r.title.slice(0, 40)}`);
  console.log(`     ${String(r.detail).slice(0, 90)}`);
}
db.close();
