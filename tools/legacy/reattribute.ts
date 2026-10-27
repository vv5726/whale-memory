import { openDb } from "../src/db.ts";

/**
 * 把记忆归到「真正说这话的人」名下。
 *
 * 之前是按「那天最后说话的人」一锅贴——同一天群里的发言全算成了主人。
 * 现在改成按内容匹配：拿这条记忆的正文，去跟当天每条对话比字面重合，
 * 最像的那条是谁说的，就归给谁。
 */

function grams(s: string, n = 3): Set<string> {
  const t = String(s ?? "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
  const out = new Set<string>();
  for (let i = 0; i + n <= t.length; i += 1) out.add(t.slice(i, i + n));
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const g of a) if (b.has(g)) n += 1;
  return n / Math.min(a.size, b.size);
}

const db = openDb("data/memory.db");

const events = db
  .prepare("SELECT id, day, title, detail, speaker_id FROM events WHERE archived = 0")
  .all() as Array<{ id: string; day: string; title: string; detail: string; speaker_id: string }>;

let changed = 0;
let unknown = 0;

for (const e of events) {
  const turns = db
    .prepare("SELECT text, speaker_id FROM turns WHERE day = ? AND speaker_id <> ''")
    .all(e.day) as Array<{ text: string; speaker_id: string }>;
  if (turns.length === 0) continue;

  const eg = grams(`${e.title} ${e.detail}`);
  let best: { speaker: string; score: number } | null = null;
  for (const t of turns) {
    const score = overlap(eg, grams(t.text));
    if (!best || score > best.score) best = { speaker: t.speaker_id, score };
  }

  if (!best || best.score < 0.25) {
    unknown += 1;
    continue;
  }
  if (best.speaker === e.speaker_id) continue;

  db.prepare("UPDATE events SET speaker_id = ? WHERE id = ?").run(best.speaker, e.id);
  changed += 1;
}

console.log(`重新归属 ${changed} 条，${unknown} 条匹配不上（保持原样）`);

console.log("\n按人统计：");
const rows = db
  .prepare("SELECT speaker_id, COUNT(*) AS c FROM events WHERE archived = 0 GROUP BY speaker_id ORDER BY c DESC")
  .all() as Array<{ speaker_id: string; c: number }>;
for (const r of rows) console.log(`  ${r.speaker_id || "空"} → ${r.c} 条`);

db.close();
