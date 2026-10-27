import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

const q = db
  .prepare("SELECT title, archived FROM events WHERE detail LIKE ? OR title LIKE ? OR detail LIKE ? LIMIT 10")
  .all("%deepseek%", "%deepseek%", "%研发%") as Array<{ title: string; archived: number }>;

console.log(`提到 deepseek / 研发 的记忆：${q.length} 条`);
for (const r of q) console.log(`  [${Number(r.archived) === 1 ? "归档" : "有效"}] ${String(r.title).slice(0, 55)}`);

const about = db
  .prepare("SELECT title FROM events WHERE archived = 0 AND (detail LIKE ? OR detail LIKE ? OR detail LIKE ?) LIMIT 8")
  .all("%我是谁%", "%记住我%", "%叫我%") as Array<{ title: string }>;
console.log(`\n关于「他是谁」的：${about.length} 条`);
for (const r of about) console.log(`  ${String(r.title).slice(0, 55)}`);

// 现在提示词里给它的「谁是谁」
console.log("\n人表：");
for (const r of db.prepare("SELECT qq_id, display_name, aliases FROM people").all() as Array<{
  qq_id: string;
  display_name: string;
  aliases: string;
}>) {
  console.log(`  ${r.qq_id} = ${r.display_name}  别名 ${r.aliases}`);
}
db.close();
