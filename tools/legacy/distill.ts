import { openDb } from "../src/db.ts";

/**
 * 取舍：同一件事留下最有信息量的一版，其余归档。
 *
 * 症状：210 条全在 detailed，「小雨」一捞就是 55 条，但捞不出「谁说的」。
 * 原因不是缺字段，是**没有取舍**——什么都留着，等于什么都浮不上来。
 *
 * 规则：
 *   同一组（共享最多锚点的那些记忆）里，按信息量排序，留前 N 条，其余归档。
 *   信息量 = 关键事实数 + 正文长度 + 有没有人名 + 是不是分好类。
 */

const db = openDb("data/memory.db");
const KEEP_PER_GROUP = 3;

type Row = {
  id: string;
  title: string;
  detail: string;
  key_facts: string;
  kind: string;
  speaker_id: string;
  ts: number;
};

const rows = db
  .prepare("SELECT id, title, detail, key_facts, kind, speaker_id, ts FROM events WHERE archived = 0")
  .all() as Row[];

// 每条记忆挂了哪些锚点
const anchorsOf = new Map<string, string[]>();
for (const r of rows) {
  const as = db.prepare("SELECT anchor_id FROM event_anchors WHERE event_id = ?").all(r.id) as Array<{ anchor_id: string }>;
  anchorsOf.set(r.id, as.map((a) => a.anchor_id));
}

/** 信息量：越"具体"越高 */
function weight(r: Row): number {
  let w = 0;
  try {
    const kf = JSON.parse(r.key_facts || "[]") as string[];
    w += Math.min(6, (kf ?? []).length) * 2;
  } catch {
    /* */
  }
  w += Math.min(30, String(r.detail).length) / 10;
  if (r.speaker_id) w += 1;
  if (r.kind && r.kind !== "event") w += 1;
  if (/\d/.test(r.detail)) w += 1.5; // 带数字的通常更具体
  if (String(r.title).length <= 30) w += 0.5;
  return w;
}

// 按「共享锚点」聚组：用最热门的锚点当组名
const groups = new Map<string, Row[]>();
for (const r of rows) {
  const as = anchorsOf.get(r.id) ?? [];
  if (as.length === 0) {
    const g = groups.get("__nogroup") ?? [];
    g.push(r);
    groups.set("__nogroup", g);
    continue;
  }
  // 取该条最"独家"的锚点：挂的记忆最少的那个，最能代表它
  let best = as[0]!;
  let bestCount = Number.MAX_SAFE_INTEGER;
  for (const a of as) {
    const c = Number(db.prepare("SELECT COUNT(*) AS c FROM event_anchors WHERE anchor_id = ?").get(a)?.c ?? 0);
    if (c < bestCount) {
      bestCount = c;
      best = a;
    }
  }
  const g = groups.get(best) ?? [];
  g.push(r);
  groups.set(best, g);
}

let archived = 0;
let kept = 0;
for (const [group, list] of groups) {
  if (list.length <= KEEP_PER_GROUP) {
    kept += list.length;
    continue;
  }
  const ranked = list.map((r) => ({ r, w: weight(r) })).sort((a, b) => b.w - a.w);
  const keep = ranked.slice(0, KEEP_PER_GROUP);
  const drop = ranked.slice(KEEP_PER_GROUP);
  for (const k of keep) kept += 1;
  for (const d of drop) {
    db.prepare("UPDATE events SET archived = 1 WHERE id = ?").run(d.r.id);
    archived += 1;
  }
}

const left = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
console.log(`分组 ${groups.size} 个，保留 ${kept} 条，归档 ${archived} 条`);
console.log(`有效记忆：${left} 条`);

// 看一眼「小雨」现在还剩多少
const sugar = db
  .prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND (title LIKE ? OR detail LIKE ?)")
  .get("%小雨%", "%小雨%") as { c: number };
console.log(`「小雨」剩 ${sugar.c} 条（之前 55 条）`);

db.close();
