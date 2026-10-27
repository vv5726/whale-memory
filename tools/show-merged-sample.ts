import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

const losers = db
  .prepare("SELECT id, title, detail, verdict_reason FROM events WHERE archived = 1 AND verdict = 'merged' LIMIT 2")
  .all() as Array<{ id: string; title: string; detail: string; verdict_reason: string }>;

if (losers.length === 0) {
  console.log("没有 merged 记录");
  process.exit(0);
}

for (const l of losers) {
  // verdict_reason 形如「已并入「xxx」，内容保留」
  const wt = /已并入「(.+?)」，内容保留/.exec(String(l.verdict_reason))?.[1] ?? "";
  const winner = db
    .prepare("SELECT title, detail, key_facts FROM events WHERE archived = 0 AND title LIKE ? ORDER BY ts DESC LIMIT 1")
    .get(`${wt.slice(0, 12)}%`) as { title: string; detail: string; key_facts: string } | undefined;

  console.log("═══════════ 一条真实样本 ═══════════");
  console.log(`被并入的原条：${String(l.title).slice(0, 34)}`);
  console.log(`  原文：${String(l.detail).slice(0, 90)}`);
  console.log("");
  if (winner) {
    console.log(`合并后的那条：${String(winner.title).slice(0, 34)}`);
    console.log(`  合并正文：${String(winner.detail).slice(0, 260)}`);
    console.log(`  关键事实：${String(winner.key_facts).slice(0, 80)}`);
  } else {
    console.log("（胜者已不在有效集合里，可能又被合并了）");
  }
  console.log("");
}
db.close();
