// 把旧格式 group:<群号>:user:<QQ> 的会话统一回 group:<群号>，让整群历史能连上
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

if (APPLY && !existsSync("data/backup-before-session-backfill.db")) {
  copyFileSync("data/memory.db", "data/backup-before-session-backfill.db");
  console.log("备份：data/backup-before-session-backfill.db");
}

const db = new DatabaseSync("data/memory.db");
const rows = db
  .prepare("SELECT session_id, COUNT(*) c FROM turns WHERE session_id LIKE 'group:%:user:%' GROUP BY session_id")
  .all() as Array<{ session_id: string; c: number }>;
console.log("旧格式的会话：");
for (const r of rows) console.log(`  ${r.session_id}  ${r.c} 条`);

const total = rows.reduce((n, r) => n + Number(r.c), 0);
console.log(`合计 ${total} 条要改`);

if (!APPLY) {
  console.log("（干跑；加 --apply 才改）");
  db.close();
  process.exit(0);
}

const r = db
  .prepare(
    "UPDATE turns SET session_id = substr(session_id, 1, instr(session_id, ':user:') - 1) WHERE session_id LIKE 'group:%:user:%'",
  )
  .run();
console.log(`改了 ${r.changes} 条`);

const after = db
  .prepare("SELECT session_id, COUNT(*) c FROM turns WHERE session_id LIKE 'group:%' GROUP BY session_id ORDER BY c DESC")
  .all() as Array<{ session_id: string; c: number }>;
console.log("\n现在群会话：");
for (const a of after) console.log(`  ${a.session_id}  ${a.c} 条`);

// 抽查：同一个群会话里是不是还有不同说话人（确认没把谁混成谁）
const sample = db
  .prepare("SELECT speaker_id, COUNT(*) c FROM turns WHERE session_id LIKE 'group:%' GROUP BY session_id, speaker_id")
  .all() as Array<{ speaker_id: string; c: number }>;
console.log("\n各说话人条数（speaker_id 没被动过）：");
for (const s of sample) console.log(`  ${String(s.speaker_id || "(空)")}  ${s.c}`);
db.close();
