import { openDb } from "../src/db.ts";
import { recordOwnNote } from "../src/notes.ts";

const db = openDb("data/memory.db");
const before = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);

const text = "取舍线是假的，归档只打标签，stats 前后都四百多条";
recordOwnNote(db, text, Date.now());
recordOwnNote(db, text, Date.now());
recordOwnNote(db, text, Date.now());

const after = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
console.log(`记忆条数：${before} → ${after}（说三遍应该只 +1）`);

const row = db
  .prepare("SELECT title, mentions, strength FROM events WHERE detail LIKE ? ORDER BY ts DESC LIMIT 1")
  .get("%取舍线是假的%") as { title: string; mentions: number; strength: number } | undefined;
if (row) {
  console.log(`那条：mentions=${row.mentions} strength=${row.strength}`);
  console.log(`标题：${row.title}`);
}
db.close();
