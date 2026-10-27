import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const one = (sql: string): number => Number(db.prepare(sql).get()?.c ?? 0);

console.log("═══ 记忆 ═══");
console.log(`  有效 ${one("SELECT COUNT(*) AS c FROM events WHERE archived = 0")} 条｜归档 ${one("SELECT COUNT(*) AS c FROM events WHERE archived = 1")}`);
console.log("  按 stage：");
for (const r of db.prepare("SELECT stage, COUNT(*) AS c FROM events WHERE archived = 0 GROUP BY stage ORDER BY c DESC").all() as Array<{
  stage: string;
  c: number;
}>) {
  console.log(`    ${r.stage || "(空)"}：${r.c}`);
}
console.log("  按 etype（新版才有的字段）：");
for (const r of db.prepare("SELECT etype, COUNT(*) AS c FROM events WHERE archived = 0 GROUP BY etype ORDER BY c DESC").all() as Array<{
  etype: string;
  c: number;
}>) {
  console.log(`    ${r.etype || "(空/老数据)"}：${r.c}`);
}

console.log("");
console.log("═══ 锚点 ═══");
console.log(`  共 ${one("SELECT COUNT(*) AS c FROM anchors")} 个`);
for (const r of db.prepare("SELECT kind, COUNT(*) AS c FROM anchors GROUP BY kind ORDER BY c DESC").all() as Array<{
  kind: string;
  c: number;
}>) {
  console.log(`    kind=${r.kind}：${r.c}`);
}

console.log("");
console.log("═══ 关系边 ═══");
console.log(`  共 ${one("SELECT COUNT(*) AS c FROM edges")} 条`);
const w = db.prepare("SELECT MIN(weight) AS mn, MAX(weight) AS mx, AVG(weight) AS av FROM edges").get() as {
  mn: number;
  mx: number;
  av: number;
};
console.log(`  权重 min=${Number(w.mn).toFixed(2)} max=${Number(w.mx).toFixed(2)} avg=${Number(w.av).toFixed(2)}`);
console.log("  按关系类型：");
for (const r of db.prepare("SELECT relation, COUNT(*) AS c FROM edges GROUP BY relation ORDER BY c DESC LIMIT 6").all() as Array<{
  relation: string;
  c: number;
}>) {
  console.log(`    ${r.relation}：${r.c}`);
}

console.log("");
console.log("═══ 挂载 ═══");
console.log(`  event_anchors ${one("SELECT COUNT(*) AS c FROM event_anchors")} 条`);
console.log("  挂得最多的锚点：");
for (const r of db
  .prepare("SELECT a.name, a.kind, COUNT(*) AS c FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id GROUP BY a.id ORDER BY c DESC LIMIT 8")
  .all() as Array<{ name: string; kind: string; c: number }>) {
  console.log(`    ${r.name}（${r.kind}）：${r.c}`);
}
db.close();
