import { openDb } from "../src/db.ts";

const db = openDb(process.argv[2] ?? "data/qq-memory.db");
const term = process.argv[3] ?? "良性";

console.log(`=== 主库中含「${term}」的事件 ===`);
for (const r of db
  .prepare("SELECT id, day, tier, title, key_facts, core_fragment FROM events WHERE title LIKE ? OR key_facts LIKE ? OR core_fragment LIKE ? OR detail LIKE ?")
  .all(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`)) {
  console.log(JSON.stringify(r));
}

console.log(`\n=== 冷存储中含「${term}」的底片 ===`);
for (const r of db
  .prepare("SELECT event_id, address, gist FROM cold_archive WHERE raw_detail LIKE ?")
  .all(`%${term}%`)) {
  console.log(JSON.stringify(r));
}
