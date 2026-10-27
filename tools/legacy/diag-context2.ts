import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

const all = Number(db.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0);
const img = Number(db.prepare("SELECT COUNT(*) AS c FROM turns WHERE text LIKE ?").get("%CQ:image%")?.c ?? 0);
const face = Number(
  db.prepare("SELECT COUNT(*) AS c FROM turns WHERE text LIKE ? OR text LIKE ?").get("%CQ:face%", "%CQ:mface%")?.c ?? 0,
);
const speakers = Number(db.prepare("SELECT COUNT(DISTINCT speaker_id) AS c FROM turns WHERE speaker_id <> ''").get()?.c ?? 0);

console.log(`对话总数：${all}`);
console.log(`含图片 CQ 码：${img}（${Math.round((img / all) * 100)}%）`);
console.log(`含表情 CQ 码：${face}（${Math.round((face / all) * 100)}%）`);
console.log(`说话人数：${speakers}`);

// 最近 30 轮里有几个人在说话
const recent = db.prepare("SELECT speaker_id FROM turns ORDER BY seq DESC LIMIT 30").all() as Array<{
  speaker_id: string;
}>;
const set = new Set(recent.map((r) => r.speaker_id).filter(Boolean));
console.log(`最近 30 轮涉及 ${set.size} 个人：${[...set].join("、")}`);
db.close();
