import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

const total = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
const withSpeaker = Number(
  db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND speaker_id <> ''").get()?.c ?? 0,
);
const turnsTotal = Number(db.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0);
const turnsWithSpeaker = Number(db.prepare("SELECT COUNT(*) AS c FROM turns WHERE speaker_id <> ''").get()?.c ?? 0);

console.log(`事件：${total} 条，其中有说话人的 ${withSpeaker} 条`);
console.log(`对话：${turnsTotal} 条，其中有说话人的 ${turnsWithSpeaker} 条`);

const sample = db
  .prepare("SELECT title, speaker_id FROM events WHERE archived = 0 ORDER BY ts DESC LIMIT 5")
  .all() as Array<{ title: string; speaker_id: string }>;
console.log("\n最近 5 条：");
for (const r of sample) console.log(`  [${r.speaker_id || "（空）"}] ${r.title.slice(0, 45)}`);

db.close();
