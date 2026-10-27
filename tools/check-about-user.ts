import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const one = (sql: string): number => Number(db.prepare(sql).get()?.c ?? 0);

console.log(`记忆总数：${one("SELECT COUNT(*) AS c FROM events WHERE archived = 0")}`);

console.log("\n按说话人：");
for (const r of db.prepare("SELECT speaker_id, COUNT(*) AS c FROM events WHERE archived = 0 GROUP BY speaker_id").all() as Array<{
  speaker_id: string;
  c: number;
}>) {
  console.log(`  ${r.speaker_id || "空"} → ${r.c}`);
}

console.log("\n按类：");
for (const r of db.prepare("SELECT kind, COUNT(*) AS c FROM events WHERE archived = 0 GROUP BY kind").all() as Array<{
  kind: string;
  c: number;
}>) {
  console.log(`  ${r.kind} → ${r.c}`);
}

console.log("\nuser 类（关于他是谁）：");
for (const r of db.prepare("SELECT title FROM events WHERE archived = 0 AND kind = 'user' LIMIT 8").all() as Array<{
  title: string;
}>) {
  console.log(`  ${String(r.title).slice(0, 60)}`);
}

console.log("\n锚点里有没有「我 / deepseek / harness」：");
for (const r of db.prepare("SELECT name, kind FROM anchors").all() as Array<{ name: string; kind: string }>) {
  if (/deepseek|harness|助手|开发|main/i.test(r.name)) console.log(`  ${r.name}（${r.kind}）`);
}
db.close();
