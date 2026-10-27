import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const rows = db.prepare("SELECT text, ts FROM turns WHERE role = 'assistant' ORDER BY seq DESC LIMIT 5").all() as Array<{
  text: string;
  ts: number;
}>;

for (const r of rows) {
  const t = String(r.text);
  console.log(`长度 ${t.length}　${t.replace(/\s+/g, " ").slice(0, 50)}`);
}

// 找那条被截断的
const hit = db
  .prepare("SELECT text FROM turns WHERE role = 'assistant' AND text LIKE ? ORDER BY seq DESC LIMIT 1")
  .get("%我写进库里的规则%") as { text: string } | undefined;

if (hit) {
  console.log("");
  console.log(`完整那条长度：${String(hit.text).length}`);
  console.log("结尾 40 字：" + String(hit.text).slice(-40));
}
db.close();
