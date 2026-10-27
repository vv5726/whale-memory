import { openDb } from "../src/db.ts";
import { listPeople } from "../src/people.ts";

/**
 * 把剩下的「他」也换成具体的人。
 *
 * 只处理明确指向说话人的搭配（他的X、给他、跟他、对他…），
 * 遇到「他们」「其他」「他人」这些一律跳过——那是另一个意思。
 */
const db = openDb("data/memory.db");
const people = listPeople(db);
const nameOf = (qq: string): string => people.find((x) => x.qqId === qq)?.name || qq;

const events = db
  .prepare("SELECT id, title, detail, speaker_id FROM events WHERE archived = 0 AND (title LIKE '%他%' OR detail LIKE '%他%')")
  .all() as Array<{ id: string; title: string; detail: string; speaker_id: string }>;

let changed = 0;
const samples: string[] = [];

for (const e of events) {
  const who = e.speaker_id ? nameOf(e.speaker_id) : "他";
  const fix = (s: string): string =>
    s
      // 先保护不该动的
      .replace(/他们/g, "\u0000T\u0000")
      .replace(/其他/g, "\u0000Q\u0000")
      .replace(/他人/g, "\u0000R\u0000")
      // 明确指向说话人的搭配
      .replace(/他的/g, `${who}的`)
      .replace(/给他/g, `给${who}`)
      .replace(/跟他/g, `跟${who}`)
      .replace(/对他/g, `对${who}`)
      .replace(/和他/g, `和${who}`)
      .replace(/他电脑/g, `${who}电脑`)
      .replace(/他手机/g, `${who}手机`)
      .replace(/他说/g, `${who}说`)
      .replace(/他要/g, `${who}要`)
      .replace(/他会/g, `${who}会`)
      .replace(/他让/g, `${who}让`)
      .replace(/他问/g, `${who}问`)
      .replace(/他提/g, `${who}提`)
      .replace(/他给/g, `${who}给`)
      // 还原保护
      .replace(/\u0000T\u0000/g, "他们")
      .replace(/\u0000Q\u0000/g, "其他")
      .replace(/\u0000R\u0000/g, "他人");

  const title = fix(e.title);
  const detail = fix(e.detail);
  if (`${title}\n${detail}` === `${e.title}\n${e.detail}`) continue;

  if (samples.length < 3) samples.push(`  ${e.detail.slice(0, 60)}\n    → ${detail.slice(0, 60)}`);
  db.prepare("UPDATE events SET title = ?, detail = ?, updated_at = ? WHERE id = ?").run(title, detail, Date.now(), e.id);
  changed += 1;
}

console.log(`改了 ${changed} 条`);
if (samples.length > 0) {
  console.log("\n样例：");
  for (const s of samples) console.log(s);
}

const left = Number(
  db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND (title LIKE '%他%' OR detail LIKE '%他%')").get()?.c ?? 0,
);
console.log(`\n还剩含「他」的：${left} 条（多半是「他们」「其他」这类正常用法）`);
db.close();
