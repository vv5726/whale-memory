import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const one = (sql: string): number => Number(db.prepare(sql).get()?.c ?? 0);

console.log(`总记忆 ${one("SELECT COUNT(*) AS c FROM events WHERE archived = 0")} 条｜其中带 etype ${one("SELECT COUNT(*) AS c FROM events WHERE etype <> ''")} 条`);

console.log("");
console.log("按类型：");
for (const r of db
  .prepare("SELECT etype, COUNT(*) AS c FROM events WHERE etype <> '' GROUP BY etype ORDER BY c DESC")
  .all() as Array<{ etype: string; c: number }>) {
  console.log(`  ${r.etype}：${r.c}`);
}

console.log("");
console.log("按状态：");
for (const r of db
  .prepare("SELECT status, COUNT(*) AS c FROM events WHERE status <> '' GROUP BY status ORDER BY c DESC")
  .all() as Array<{ status: string; c: number }>) {
  console.log(`  ${r.status}：${r.c}`);
}

console.log("");
console.log("最近 8 条新记忆：");
for (const r of db
  .prepare("SELECT title, etype, status, memory_value FROM events WHERE etype <> '' ORDER BY ts DESC LIMIT 8")
  .all() as Array<{ title: string; etype: string; status: string; memory_value: number }>) {
  console.log(`  【${String(r.title).slice(0, 30)}】${r.etype}/${r.status} 价值${r.memory_value}`);
}

console.log("");
console.log("锚点情况：");
for (const r of db.prepare("SELECT kind, COUNT(*) AS c FROM anchors GROUP BY kind ORDER BY c DESC").all() as Array<{
  kind: string;
  c: number;
}>) {
  console.log(`  ${r.kind}：${r.c}`);
}
console.log(`  挂载 ${one("SELECT COUNT(*) AS c FROM event_anchors")}｜边 ${one("SELECT COUNT(*) AS c FROM edges")}`);
db.close();
