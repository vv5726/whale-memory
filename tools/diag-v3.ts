import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

// ① 待处理的对话到底有几条
const pending = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get() as { c: number };
console.log(`① processed = 0 的对话：${pending.c} 条`);

// ② 最新插入的测试 turn 在不在
const test = db
  .prepare("SELECT id, day, processed, text FROM turns WHERE text LIKE ? ORDER BY seq DESC LIMIT 5")
  .all("%V3TEST%") as Array<{ id: string; day: string; processed: number; text: string }>;
console.log(`② 测试 turn：${test.length} 条`);
for (const t of test) console.log(`   ${t.id} day=${t.day} processed=${t.processed}`);

// ③ sleep 的取数条件是什么
const dayCount = db
  .prepare("SELECT day, COUNT(*) AS c FROM turns WHERE processed = 0 GROUP BY day")
  .all() as Array<{ day: string; c: number }>;
console.log("③ 待处理按天：");
for (const d of dayCount) console.log(`   ${d.day}：${d.c} 条`);

// ④ 最新事件的时间，看 +2 是哪来的
const latest = db
  .prepare("SELECT title, day, ts, stage, context_kinds FROM events ORDER BY ts DESC LIMIT 3")
  .all() as Array<{ title: string; day: string; ts: number; stage: string; context_kinds: string }>;
console.log("④ 最新 3 条事件：");
for (const e of latest) {
  console.log(`   [${e.day}] ${String(e.title).slice(0, 28)}　stage=${e.stage}　kind=${String(e.context_kinds).slice(0, 30)}`);
}

db.close();
