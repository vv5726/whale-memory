// 对正式库执行一次边限流 + VACUUM（先备份）。只跑一次的事后处理。
import { copyFileSync, existsSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pruneSameDayEdges } from "../src/anchors.ts";

const dbPath = "data/memory.db";
const backup = "data/backup-before-edge-prune.db";
if (!existsSync(backup)) {
  copyFileSync(dbPath, backup);
  console.log(`备份：${backup}（${(statSync(backup).size / 1024 / 1024).toFixed(1)} MB）`);
}

const sizeOf = () => (statSync(dbPath).size / 1024 / 1024).toFixed(1);
console.log(`执行前：${sizeOf()} MB`);

const db = new DatabaseSync(dbPath);
const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
const before = n("SELECT COUNT(*) AS n FROM edges");
console.log(`  edges ${before} 条（same-day ${n("SELECT COUNT(*) AS n FROM edges WHERE relation='same-day'")}）`);

const deleted = pruneSameDayEdges(db, 240, Date.now());
const after = n("SELECT COUNT(*) AS n FROM edges");
console.log(`  删掉 ${deleted} 条 → 剩 ${after} 条`);

db.exec("VACUUM");
db.close();
console.log(`VACUUM 之后：${sizeOf()} MB`);
