import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

const total = db.prepare("SELECT COUNT(*) AS c FROM edges").get() as { c: number };
console.log(`edges 总数：${total.c}`);

const cols = (db.prepare("PRAGMA table_info(edges)").all() as Array<{ name: string }>).map((r) => r.name);
console.log(`edges 字段：${cols.join(", ")}`);

// 按 kind 分布
try {
  for (const r of db.prepare("SELECT kind, COUNT(*) AS c FROM edges GROUP BY kind ORDER BY c DESC LIMIT 6").all() as Array<{
    kind: string;
    c: number;
  }>) {
    console.log(`  kind=${r.kind}：${r.c}`);
  }
} catch {
  console.log("  没有 kind 列");
}

// 最近形成的（如果有时间列）
const tcol = cols.find((c) => c.includes("ts") || c.includes("created") || c.includes("updated"));
if (tcol) {
  const recent = db
    .prepare(`SELECT COUNT(*) AS c FROM edges WHERE ${tcol} > ?`)
    .get(Date.now() - 30 * 60_000) as { c: number };
  console.log(`  最近 30 分钟新增：${recent.c}`);
}

// 哪个锚点连接最多
console.log("");
console.log("边最多的锚点 TOP 5：");
for (const r of db
  .prepare(
    `SELECT a.name, COUNT(*) AS c FROM edges e
     JOIN anchors a ON a.id = e.src GROUP BY a.id ORDER BY c DESC LIMIT 5`,
  )
  .all() as Array<{ name: string; c: number }>) {
  console.log(`  ${r.name}：${r.c}`);
}
db.close();
