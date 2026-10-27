// 清掉历史里「额度用完了」那些假回复（它们不是她说的），先备份再删
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const PREFIX = "今天的额度用完了";

const bak = `data/backup-before-clean-exhausted-turns-${Date.now()}.db`;
if (APPLY && !existsSync(bak)) {
  copyFileSync("data/memory.db", bak);
  console.log(`备份：${bak}`);
}

const db = new DatabaseSync("data/memory.db");
const rows = db.prepare("SELECT id, day, role, substr(text, 1, 40) AS t FROM turns WHERE text LIKE ? ORDER BY ts").all(`%${PREFIX}%`);
console.log(`命中 ${rows.length} 条：`);
for (const r of rows.slice(0, 10)) console.log(`  ${r.day} ${r.role} ${r.t}…`);
if (rows.length > 10) console.log(`  …还有 ${rows.length - 10} 条`);

const byRole = db.prepare("SELECT role, COUNT(*) c FROM turns WHERE text LIKE ? GROUP BY role").all(`%${PREFIX}%`);
console.log("按 role 分：", JSON.stringify(byRole));

// 也看看有没有被抽成记忆的
const ev = db.prepare("SELECT COUNT(*) c FROM events WHERE detail LIKE ? OR title LIKE ?").get(`%${PREFIX}%`, `%${PREFIX}%`);
console.log("已经被抽成记忆的：", ev.c, "条");

if (APPLY) {
  const r = db.prepare("DELETE FROM turns WHERE text LIKE ?").run(`%${PREFIX}%`);
  console.log(`删掉 ${r.changes} 条 turns`);
  const left = db.prepare("SELECT COUNT(*) c FROM turns WHERE text LIKE ?").get(`%${PREFIX}%`);
  console.log("剩下：", left.c, "条");
} else {
  console.log("（干跑，没删；加 --apply 才真删）");
}
db.close();
