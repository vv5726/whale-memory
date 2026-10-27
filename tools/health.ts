import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const one = (sql: string): number => Number(db.prepare(sql).get()?.c ?? 0);

console.log(`有效记忆        ${one("SELECT COUNT(*) AS c FROM events WHERE archived = 0")}`);
console.log(`归档            ${one("SELECT COUNT(*) AS c FROM events WHERE archived = 1")}`);
console.log(`钉住            ${one("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND pinned = 1")}`);
console.log(`分层            ${JSON.stringify(db.prepare("SELECT tier, COUNT(*) AS c FROM events WHERE archived = 0 GROUP BY tier").all())}`);
console.log(`分类            ${JSON.stringify(db.prepare("SELECT kind, COUNT(*) AS c FROM events WHERE archived = 0 GROUP BY kind").all())}`);
console.log(`带说话人        ${one("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND speaker_id <> ''")}`);
console.log(`锚点            ${one("SELECT COUNT(*) AS c FROM anchors")}`);
console.log(`关系            ${one("SELECT COUNT(*) AS c FROM edges")}`);
console.log(`挂在锚点上的记忆 ${one("SELECT COUNT(DISTINCT event_id) AS c FROM event_anchors")}`);
console.log(`孤立记忆（没锚点）${one("SELECT COUNT(*) AS c FROM events e WHERE archived = 0 AND NOT EXISTS (SELECT 1 FROM event_anchors ea WHERE ea.event_id = e.id)")}`);
console.log(`原始对话        ${one("SELECT COUNT(*) AS c FROM turns")}`);
console.log(`待整理          ${one("SELECT COUNT(*) AS c FROM turns WHERE processed = 0")}`);
console.log(`冷存储          ${one("SELECT COUNT(*) AS c FROM cold_archive")}`);

const tokens = Number(
  (db.prepare("SELECT COALESCE(SUM(size_tokens),0) AS t FROM events WHERE archived = 0").get() as { t: number }).t,
);
console.log(`总 token        ${tokens}`);
db.close();
