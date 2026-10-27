import { openDb } from "../src/db.ts";
import { listPeople } from "../src/people.ts";

/**
 * 把旧记忆里的代词换成具体的人。
 *
 * 记忆是从凝的视角写的：正文里的「对方」「本人」都指当时跟他说话的那个人，
 * 也就是那条记忆的 speaker_id。所以能确定性替换，不用猜。
 */
const db = openDb("data/memory.db");

const people = listPeople(db);
const nameOf = (qq: string): string => {
  const p = people.find((x) => x.qqId === qq);
  return p?.name || qq;
};

const events = db
  .prepare("SELECT id, title, detail, speaker_id FROM events WHERE archived = 0")
  .all() as Array<{ id: string; title: string; detail: string; speaker_id: string }>;

let changed = 0;
for (const e of events) {
  const who = e.speaker_id ? nameOf(e.speaker_id) : "他";
  const before = `${e.title}\n${e.detail}`;
  const fix = (s: string): string =>
    s
      .split("对方").join(who)
      .split("本人").join(who)
      .split("他说").join(`${who}说`)
      .split("她说").join(`${who}说`)
      .split("给他的").join(`给${who}的`)
      .split("给他").join(`给${who}`)
      .split("对他").join(`对${who}`)
      .split("他提的").join(`${who}提的`);

  const title = fix(e.title);
  const detail = fix(e.detail);
  if (`${title}\n${detail}` === before) continue;

  db.prepare("UPDATE events SET title = ?, detail = ?, updated_at = ? WHERE id = ?").run(title, detail, Date.now(), e.id);
  changed += 1;
}

console.log(`改了 ${changed} 条记忆里的代词`);

for (const w of ["对方", "本人", "他说", "她说"]) {
  const c = Number(
    db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND (title LIKE ? OR detail LIKE ?)").get(`%${w}%`, `%${w}%`)?.c ?? 0,
  );
  console.log(`  还剩含「${w}」：${c} 条`);
}

const sample = db.prepare("SELECT title FROM events WHERE archived = 0 ORDER BY ts DESC LIMIT 4").all() as Array<{
  title: string;
}>;
console.log("\n最近几条：");
for (const s of sample) console.log(`  ${s.title.slice(0, 60)}`);
db.close();
