import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const src = "data/memory.db";
const dir = join(homedir(), ".dsh", "whale-memory");
const dst = join(dir, "memory.db");

// 先把 WAL 落盘，否则复制出来的库缺最近的改动
const db = new DatabaseSync(src);
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
const archived = db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 1").get()?.c ?? 0;
const total = db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0;
db.close();

copyFileSync(src, dst);
for (const ext of ["-wal", "-shm"]) {
  const p = `${src}${ext}`;
  if (existsSync(p)) copyFileSync(p, `${dst}${ext}`);
}

const check = new DatabaseSync(dst, { readOnly: true });
const archived2 = check.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 1").get()?.c ?? 0;
const total2 = check.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0;
check.close();

console.log(`源库：${total} 条（归档 ${archived}）`);
console.log(`插件库：${total2} 条（归档 ${archived2}）`);
console.log(total2 === total ? "✓ 一致" : "✗ 不一致");
