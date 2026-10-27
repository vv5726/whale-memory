import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'events'").get() as { sql: string };
const sql = String(row.sql);
const i = sql.indexOf("speaker_id");
console.log(i >= 0 ? sql.slice(Math.max(0, i - 8), i + 50) : "没有 speaker_id 这一列");
db.close();
