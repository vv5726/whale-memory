import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

const rows = db
  .prepare("SELECT role, speaker_id, text FROM turns WHERE role = 'user' ORDER BY seq DESC LIMIT 10")
  .all() as Array<{ role: string; speaker_id: string; text: string }>;

console.log("最近 10 条用户消息的说话人：");
for (const r of rows) {
  console.log(`  speaker=${r.speaker_id || "(空)"}　${String(r.text).replace(/\s+/g, " ").slice(0, 40)}`);
}

console.log("");
console.log("按说话人分组计数：");
for (const r of db.prepare("SELECT speaker_id, COUNT(*) AS c FROM turns WHERE role = 'user' GROUP BY speaker_id ORDER BY c DESC LIMIT 8").all() as Array<{ speaker_id: string; c: number }>) {
  console.log(`  ${r.speaker_id || "(空)"}：${r.c} 条`);
}
db.close();
