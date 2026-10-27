import { DatabaseSync } from "node:sqlite";

/**
 * 把已有记忆里的「你」改成「对方」——只动明显是「指对方」的那些。
 * 判断规则很保守：只改「调侃你」「说你」「叫你」这类动词后面的「你」，
 * 而且整条记忆里不能已经出现「对方」。
 */
const db = new DatabaseSync("data/memory.db");

const rows = db
  .prepare("SELECT id, title, detail FROM events WHERE archived = 0 AND (title LIKE ? OR detail LIKE ?)")
  .all("%你%", "%你%") as Array<{ id: string; title: string; detail: string }>;

const patterns: Array<[RegExp, string]> = [
  [/调侃你是/gu, "调侃对方是"],
  [/调侃你叫/gu, "调侃对方叫"],
  [/叫你小雨/gu, "叫对方小雨"],
  [/说你是个/gu, "说对方是个"],
  [/说你/gu, "说对方"],
  [/给你起的/gu, "给对方的"],
  [/说你的/gu, "说对方的"],
];

let changed = 0;
for (const r of rows) {
  let title = r.title;
  let detail = r.detail;
  if (title.includes("对方") || detail.includes("对方")) continue;

  const before = `${title}\n${detail}`;
  for (const [re, to] of patterns) {
    title = title.replace(re, to);
    detail = detail.replace(re, to);
  }
  const after = `${title}\n${detail}`;
  if (after === before) continue;

  db.prepare("UPDATE events SET title = ?, detail = ?, updated_at = ? WHERE id = ?").run(title, detail, Date.now(), r.id);
  changed += 1;
  console.log(`改：${title.slice(0, 50)}`);
}

console.log(`\n共修改 ${changed} 条`);
const left = Number(
  db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND (title LIKE ? OR detail LIKE ?)").get("%说你%", "%说你%")?.c ?? 0,
);
console.log(`还剩含「说你」的：${left} 条`);
db.close();
