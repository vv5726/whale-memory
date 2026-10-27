import { openDb } from "../src/db.ts";

/** 把现有空着的说话人一次性补齐（用「那天是谁在说话」兜底） */
const db = openDb("data/memory.db");

const before = Number(
  db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND speaker_id = ''").get()?.c ?? 0,
);

db.exec(`
  UPDATE events
  SET speaker_id = COALESCE(
    (SELECT t.speaker_id FROM turns t
      WHERE t.day = events.day AND t.role = 'user' AND t.speaker_id <> ''
      ORDER BY t.seq DESC LIMIT 1),
    ''
  )
  WHERE speaker_id = '' OR speaker_id IS NULL
`);

// 对话侧：老的 turn 没记说话人，而绝大多数是主人在私聊里说的
db.exec(`
  UPDATE turns
  SET speaker_id = '10001'
  WHERE (speaker_id = '' OR speaker_id IS NULL)
`);

const after = Number(
  db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND speaker_id = ''").get()?.c ?? 0,
);
const total = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);

console.log(`事件：空的从 ${before} 条降到 ${after} 条（共 ${total} 条）`);
console.log(`对话：全部补上说话人`);

const sample = db.prepare("SELECT title, speaker_id FROM events WHERE archived = 0 ORDER BY ts DESC LIMIT 3").all() as Array<{
  title: string;
  speaker_id: string;
}>;
for (const r of sample) console.log(`  [${r.speaker_id || "空"}] ${r.title.slice(0, 40)}`);

db.close();
