import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const anchor = db.prepare("SELECT id FROM anchors WHERE name = ?").get("小雨") as { id: string } | undefined;
const ev = db.prepare("SELECT id FROM events WHERE title LIKE ? ORDER BY ts DESC LIMIT 1").get("%小雨 = %") as { id: string } | undefined;

if (!anchor || !ev) {
  console.log("锚点或事件没找到", { anchor: !!anchor, ev: !!ev });
} else {
  db.prepare("INSERT OR IGNORE INTO event_anchors (event_id, anchor_id) VALUES (?,?)").run(ev.id, anchor.id);
  console.log("已挂在锚点「小雨」上");
}
db.close();
