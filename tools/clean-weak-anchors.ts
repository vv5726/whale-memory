import { openDb } from "../src/db.ts";
import { readFileSync, writeFileSync } from "node:fs";

const db = openDb("data/memory.db");

const before = db.prepare("SELECT COUNT(*) AS c FROM event_anchors").get() as { c: number };
const weak = db.prepare("SELECT COUNT(*) AS c FROM event_anchors WHERE weight < 2").get() as { c: number };
console.log(`清理前：关系 ${before.c} 条，其中弱关联 ${weak.c} 条`);

// ① 删掉所有弱关联
db.prepare("DELETE FROM event_anchors WHERE weight < 2").run();

// ② 变成孤儿的（没有任何锚点），给它留一条最强/最早的，别让它彻底搜不到
const orphans = db
  .prepare(
    `SELECT e.id AS id FROM events e
     WHERE e.archived = 0
       AND NOT EXISTS (SELECT 1 FROM event_anchors ea WHERE ea.event_id = e.id)`,
  )
  .all() as Array<{ id: string }>;

let rescued = 0;
for (const o of orphans) {
  // 找当天挂得最多的那个锚点（至少让它在同一天里能连上）
  const row = db
    .prepare(
      `SELECT a.id AS aid FROM events e
       JOIN events e2 ON e2.day = e.day AND e2.archived = 0 AND e2.id <> e.id
       JOIN event_anchors ea ON ea.event_id = e2.id
       JOIN anchors a ON a.id = ea.anchor_id
       WHERE e.id = ?
       GROUP BY a.id ORDER BY COUNT(*) DESC LIMIT 1`,
    )
    .get(o.id) as { aid: string } | undefined;
  if (row?.aid) {
    db.prepare("INSERT OR IGNORE INTO event_anchors(event_id, anchor_id, weight) VALUES(?,?,1.5)").run(o.id, row.aid);
    rescued += 1;
  }
}

const after = db.prepare("SELECT COUNT(*) AS c FROM event_anchors").get() as { c: number };
const stillOrphan = db
  .prepare(
    "SELECT COUNT(*) AS c FROM events e WHERE e.archived = 0 AND NOT EXISTS (SELECT 1 FROM event_anchors ea WHERE ea.event_id = e.id)",
  )
  .get() as { c: number };

console.log(`清理后：关系 ${after.c} 条`);
console.log(`变成孤儿的 ${orphans.length} 条，救回 ${rescued} 条，仍空 ${stillOrphan.c} 条`);
console.log("");
console.log("锚点挂载量 TOP 6（清理后）：");
for (const r of db
  .prepare(
    "SELECT a.name, COUNT(*) AS c FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id GROUP BY a.id ORDER BY c DESC LIMIT 6",
  )
  .all() as Array<{ name: string; c: number }>) {
  console.log(`  ${r.name}：${r.c} 条`);
}
db.close();

// ③ 关掉「补挂当天锚点」——它就是弱边的源头
const p = "src/sleep.ts";
let s = readFileSync(p, "utf8");
if (!s.includes("attachDayAnchors(db, day)  // 已停用")) {
  s = s.replace(/attachDayAnchors\(([^)]*)\)/g, "(() => 0)()  // attachDayAnchors($1)  // 已停用：它把当天所有锚点都挂上，等于把锚点变成垃圾桶");
  writeFileSync(p, s, "utf8");
  console.log("");
  console.log("已停用 attachDayAnchors（弱边的源头）");
}
