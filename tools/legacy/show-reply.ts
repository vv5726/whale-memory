import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const rows = db
  .prepare("SELECT text FROM turns WHERE role = 'assistant' AND text LIKE ? ORDER BY seq DESC LIMIT 2")
  .all("%字段没落地%") as Array<{ text: string }>;

if (rows.length === 0) {
  console.log("没找到那条回复");
} else {
  console.log(rows[0]!.text);
}
db.close();
