/** 证明心情会随时间回落到平静 */
import { openDb } from "../src/db.ts";
import { recall } from "../src/recall.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

const db = openDb("data/users/10001.db");
const now = Date.now();

const put = (hoursAgo: number): void => {
  db.prepare(
    `INSERT INTO mood_state(id, valence, arousal, label, note, updated_at)
     VALUES('current', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       valence = excluded.valence, arousal = excluded.arousal,
       label = excluded.label, updated_at = excluded.updated_at`,
  ).run(-0.8, 0.9, "发蔫", "测试", now - hoursAgo * 3_600_000);
};

console.log("（初始情绪：valence -0.8 / arousal 0.9 / 发蔫）\n");
for (const h of [0, 5, 10, 24, 72]) {
  put(h);
  const r = recall(db, DEFAULT_CONFIG, "随便聊聊", { sessionId: "m" });
  console.log(`距上次 ${String(h).padStart(2)} 小时 → ${r.contextBlock.split("\n")[0]}`);
}
