import { openDb } from "../src/db.ts";
import { linkEventPerson, personAnchorFor, resolvePerson } from "../src/people.ts";

/**
 * 把已有记忆的人称落到人节点上，并写明角色。
 *
 * 规则（保守）：
 *   - 事件的 speaker_id（QQ 号） → speaker
 *   - 锚点里能解析成人的名字 → subject
 *   - 其余保持 mentioned
 */
const db = openDb("data/memory.db");

const events = db
  .prepare("SELECT id, title, detail, speaker_id FROM events WHERE archived = 0")
  .all() as Array<{ id: string; title: string; detail: string; speaker_id: string }>;

let speakers = 0;
let subjects = 0;

for (const e of events) {
  // 说话人
  if (e.speaker_id) {
    const aid = personAnchorFor(db, e.speaker_id);
    if (aid) {
      linkEventPerson(db, e.id, aid, "speaker", 1.5);
      speakers += 1;
    }
  }

  // 正文里出现的人名 → subject
  const text = `${e.title} ${e.detail}`;
  const people = db.prepare("SELECT qq_id, display_name, anchor_id FROM people").all() as Array<{
    qq_id: string;
    display_name: string;
    anchor_id: string;
  }>;
  for (const p of people) {
    if (p.display_name && text.includes(p.display_name)) {
      linkEventPerson(db, e.id, p.anchor_id, "subject", 1.2);
      subjects += 1;
    }
  }
}

const roles = db.prepare("SELECT role, COUNT(*) AS c FROM event_anchors GROUP BY role").all() as Array<{
  role: string;
  c: number;
}>;

console.log(`处理 ${events.length} 条记忆`);
console.log(`  说话人连线 ${speakers} 次，对象连线 ${subjects} 次`);
console.log("\n角色分布：");
for (const r of roles) console.log(`  ${r.role}: ${r.c}`);

// 验证：关于「林溪」这件事，能分出「他说的」和「说他」
const person = resolvePerson(db, "林溪");
if (person) {
  const asSpeaker = Number(
    db.prepare("SELECT COUNT(*) AS c FROM event_anchors WHERE anchor_id = ? AND role = 'speaker'").get(person.anchorId)?.c ?? 0,
  );
  const asSubject = Number(
    db.prepare("SELECT COUNT(*) AS c FROM event_anchors WHERE anchor_id = ? AND role = 'subject'").get(person.anchorId)?.c ?? 0,
  );
  console.log(`\n林溪：作为说话人 ${asSpeaker} 条，作为被说的人 ${asSubject} 条`);
}
db.close();
