import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

const total = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
const withSpeaker = Number(
  db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND speaker_id <> ''").get()?.c ?? 0,
);
console.log(`有效记忆 ${total} 条，带说话人 ${withSpeaker} 条`);

console.log("\n锚点按类型：");
const kinds = db.prepare("SELECT kind, COUNT(*) AS c FROM anchors GROUP BY kind ORDER BY c DESC").all() as Array<{
  kind: string;
  c: number;
}>;
for (const k of kinds) console.log(`  ${k.kind || "?"}: ${k.c}`);

console.log("\n锚点清单：");
const names = db.prepare("SELECT name FROM anchors ORDER BY hits DESC").all() as Array<{ name: string }>;
console.log("  " + names.map((n) => n.name).join("、"));

console.log("\n最近 6 条的说话人：");
const recent = db
  .prepare("SELECT title, speaker_id, context_kinds FROM events WHERE archived = 0 ORDER BY ts DESC LIMIT 6")
  .all() as Array<{ title: string; speaker_id: string; context_kinds: string }>;
for (const r of recent) {
  console.log(`  [${r.speaker_id || "空"}] ${r.title.slice(0, 40)}  (${r.context_kinds})`);
}
db.close();
