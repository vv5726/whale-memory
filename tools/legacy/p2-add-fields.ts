import { mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../src/db.ts";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-${ts}`);
mkdirSync(dir, { recursive: true });

// ① 备份数据库 + 即将被改的源码
copyFileSync("data/memory.db", join(dir, "memory.db"));
for (const f of ["src/db.ts", "src/llm/extract.ts", "src/recall.ts", "src/bot/service.ts", "src/tools/index.ts"]) {
  try {
    copyFileSync(f, join(dir, f.replace(/[\\/]/g, "_")));
  } catch {
    /* 文件不在就跳过 */
  }
}
console.log(`① 备份到 ${dir}`);

// ② 加字段（只加列，不动内容）
const db = openDb("data/memory.db");
const cols: Array<[string, string]> = [
  ["etype", "TEXT NOT NULL DEFAULT ''"],
  ["status", "TEXT NOT NULL DEFAULT ''"],
  ["responsible", "TEXT NOT NULL DEFAULT ''"],
  ["time_absolute", "TEXT NOT NULL DEFAULT ''"],
  ["time_relative", "TEXT NOT NULL DEFAULT ''"],
  ["place", "TEXT NOT NULL DEFAULT ''"],
  ["evidence", "TEXT NOT NULL DEFAULT ''"],
  ["sensitivity", "TEXT NOT NULL DEFAULT ''"],
  ["expires_at", "INTEGER"],
  ["memory_value", "INTEGER NOT NULL DEFAULT 0"],
  ["valid_to", "INTEGER"],
  ["superseded_by", "TEXT NOT NULL DEFAULT ''"],
];

const have = new Set(
  (db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>).map((r) => r.name),
);
let added = 0;
for (const [name, def] of cols) {
  if (have.has(name)) continue;
  db.prepare(`ALTER TABLE events ADD COLUMN ${name} ${def}`).run();
  added += 1;
}
console.log(`② 新加字段 ${added} 个（已有 ${cols.length - added} 个）`);

// ③ 老数据标 legacy
const old = db
  .prepare("UPDATE events SET stage = 'legacy' WHERE stage <> 'legacy' AND archived = 0")
  .run();
console.log(`③ 标 legacy：${Number(old.changes ?? 0)} 条`);

// ④ 现状
const live = db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get() as { c: number };
const legacy = db.prepare("SELECT COUNT(*) AS c FROM events WHERE stage = 'legacy'").get() as { c: number };
console.log(`④ 有效 ${live.c} 条，其中 legacy ${legacy.c} 条`);
console.log("");
console.log(`回滚方法：把 ${join(dir, "memory.db")} 复制回 data/memory.db 即可（源码备份同名带下划线）`);
db.close();
