import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

console.log("人表：");
for (const r of db.prepare("SELECT qq_id, display_name, aliases FROM people").all() as Array<{
  qq_id: string;
  display_name: string;
  aliases: string;
}>) {
  console.log(`  ${r.qq_id} = ${r.display_name || "(空)"}　别名 ${r.aliases}`);
}

const byName = db
  .prepare("SELECT title FROM events WHERE archived = 0 AND (title LIKE ? OR detail LIKE ?) LIMIT 6")
  .all("%马总%", "%马总%") as Array<{ title: string }>;
console.log(`\n提到「马总」的记忆：${byName.length} 条`);
for (const h of byName) console.log(`  ${String(h.title).slice(0, 44)}`);

const byEmoji = db
  .prepare("SELECT title FROM events WHERE archived = 0 AND (title LIKE ? OR detail LIKE ?) LIMIT 5")
  .all("%🌿%", "%🌿%") as Array<{ title: string }>;
console.log(`\n提到「🌿」的记忆：${byEmoji.length} 条`);
for (const h of byEmoji) console.log(`  ${String(h.title).slice(0, 44)}`);

const anchor = db.prepare("SELECT name, kind FROM anchors WHERE name LIKE ?").all("%马总%") as Array<{
  name: string;
  kind: string;
}>;
console.log(`\n锚点里有「马总」：${anchor.length} 个 ${anchor.map((a) => `${a.name}(${a.kind})`).join("、")}`);
db.close();
