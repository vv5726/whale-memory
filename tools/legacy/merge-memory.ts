import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../src/db.ts";

const dir = "data/users";
const target = "data/memory.db";

if (existsSync(target)) {
  copyFileSync(target, "data/memory.db.bak");
  console.log("已备份旧的 memory.db");
}

const files = readdirSync(dir).filter((f) => f.endsWith(".db"));
if (files.length === 0) {
  console.log("没有分人库");
  process.exit(0);
}

const scored = files
  .map((f) => {
    const p = join(dir, f);
    const db = openDb(p);
    const events = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
    const turns = Number(db.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0);
    db.close();
    return { file: p, events, turns, size: statSync(p).size };
  })
  .sort((a, b) => b.events - a.events || b.turns - a.turns);

const main = scored[0]!;
console.log(`主库：${main.file}（事件 ${main.events}，对话 ${main.turns}）`);
copyFileSync(main.file, target);

const db = openDb(target);
const nextSeq = (): number => {
  const row = db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM turns").get() as { m: number };
  return Number(row.m) + 1;
};

for (const s of scored.slice(1)) {
  const src = openDb(s.file);
  const rows = src.prepare("SELECT day, role, text, ts FROM turns ORDER BY seq ASC").all() as Array<{
    day: string;
    role: string;
    text: string;
    ts: number;
  }>;
  let added = 0;
  for (const r of rows) {
    const dup = db.prepare("SELECT 1 FROM turns WHERE day = ? AND role = ? AND text = ?").get(r.day, r.role, r.text);
    if (dup) continue;
    db.prepare("INSERT INTO turns (id, seq, day, ts, role, text, processed, created_at) VALUES (?,?,?,?,?,?,0,?)").run(
      `tn_${Math.random().toString(36).slice(2, 12)}`,
      nextSeq(),
      r.day,
      Number(r.ts ?? Date.now()),
      r.role,
      r.text,
      Date.now(),
    );
    added += 1;
  }

  const anchors = src.prepare("SELECT name, kind, salience FROM anchors").all() as Array<{
    name: string;
    kind: string;
    salience: number;
  }>;
  let aAdded = 0;
  for (const a of anchors) {
    const dup = db.prepare("SELECT 1 FROM anchors WHERE name = ?").get(a.name);
    if (dup) continue;
    db.prepare(
      "INSERT INTO anchors (id, name, kind, salience, hits, first_seen, last_seen) VALUES (?,?,?,?,?,?,?)",
    ).run(
      `an_${Math.random().toString(36).slice(2, 12)}`,
      a.name,
      a.kind,
      Number(a.salience ?? 1),
      1,
      Date.now(),
      Date.now(),
    );
    aAdded += 1;
  }

  src.close();
  console.log(`  ${s.file} → 对话 ${added} 条，锚点 ${aAdded} 个`);
}

const total = {
  events: Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0),
  turns: Number(db.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0),
  anchors: Number(db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c ?? 0),
  pending: Number(db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get()?.c ?? 0),
};
db.close();
console.log(`\n合并完成：${target}`);
console.log(`  事件 ${total.events}，对话 ${total.turns}，锚点 ${total.anchors}，待整理 ${total.pending}`);
