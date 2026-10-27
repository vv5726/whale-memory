import { DatabaseSync } from "node:sqlite";

/**
 * 「小雨」被记了 6 次，只留一条最好的，其余归档。
 * （这正它自己说的：「我记重了不是记性好，是没做冲突清洗」）
 */
const db = new DatabaseSync("data/memory.db");

const rows = db
  .prepare("SELECT id, title, detail, key_facts FROM events WHERE archived = 0 AND (title LIKE ? OR detail LIKE ?)")
  .all("%小雨%", "%小雨%") as Array<{ id: string; title: string; detail: string; key_facts: string }>;

// 评分：带关键事实 + 有释义 + 不是元叙述
const score = (r: { title: string; detail: string; key_facts: string }) => {
  let s = 0;
  try {
    const kf = JSON.parse(r.key_facts || "[]");
    s += Array.isArray(kf) ? kf.length : 0;
  } catch {
    /* */
  }
  if (/代表|意思是|起因|因为/.test(r.detail)) s += 3;
  if (/本人|询问|说对方是个/.test(r.title)) s -= 2;
  if (r.detail.length > 40) s += 1;
  return s;
};

const ranked = rows.map((r) => ({ ...r, s: score(r) })).sort((a, b) => b.s - a.s);
const keep = ranked[0];

console.log("保留：", keep?.title);
for (const r of ranked.slice(1)) {
  db.prepare("UPDATE events SET archived = 1 WHERE id = ?").run(r.id);
  console.log("归档：", r.title.slice(0, 40));
}

// 把保留那条的正文统一成「对方」视角
if (keep) {
  const better =
    "小雨 = 群友调侃对方（主人）早期有点呆。起因是它刚开始比较呆、没现在聪明，「糖」代表不聪明，群友就在群里这么叫它。";
  db.prepare("UPDATE events SET detail = ?, key_facts = ?, updated_at = ? WHERE id = ?").run(
    better,
    JSON.stringify(["小雨", "糖=不聪明", "群友起的绰号", "测试群里叫的"]),
    Date.now(),
    keep.id,
  );
  console.log("\n正文已统一：", better);
}

const left = db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND (title LIKE ? OR detail LIKE ?)").get("%小雨%", "%小雨%") as { c: number };
console.log(`\n有效的小雨记忆：${left.c} 条`);
db.close();
