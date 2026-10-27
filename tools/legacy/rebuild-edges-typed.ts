/**
 * 关系边分类别重算。
 *
 * 一条规则：一对锚点只存一行（保持你说的「一条关系」），
 * 但这一行带类型——取证据最强的那种。
 *
 * 类型优先级：supersede > co-occur > same-event > same-person > scene
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../src/db.ts";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-edges-typed-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("data/memory.db", join(dir, "memory.db"));
console.log(`① 备份 → ${dir}`);

const db = openDb("data/memory.db");

const links = db.prepare("SELECT event_id, anchor_id FROM event_anchors").all() as Array<{
  event_id: string;
  anchor_id: string;
}>;

const kindOf = new Map<string, string>();
for (const r of db.prepare("SELECT id, kind FROM anchors").all() as Array<{ id: string; kind: string }>) {
  kindOf.set(r.id, r.kind);
}

const anchorsOfEvent = new Map<string, string[]>();
for (const l of links) {
  const list = anchorsOfEvent.get(l.event_id) ?? [];
  list.push(l.anchor_id);
  anchorsOfEvent.set(l.event_id, list);
}

// 证据表：pair -> { 类型 -> 次数 }
const evidence = new Map<string, Map<string, number>>();
const bump = (a: string, b: string, relation: string): void => {
  if (a === b) return;
  const [x, y] = [a, b].sort();
  const key = `${x}\u0000${y}`;
  const m = evidence.get(key) ?? new Map<string, number>();
  m.set(relation, (m.get(relation) ?? 0) + 1);
  evidence.set(key, m);
};

// ① co-occur：同一条记忆里同时出现
for (const anchors of anchorsOfEvent.values()) {
  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) bump(anchors[i]!, anchors[j]!, "co-occur");
  }
}

// ② same-event：同一个「事」下面，不同记忆的锚点之间连
const eventsOfAnchor = new Map<string, string[]>();
for (const l of links) {
  const list = eventsOfAnchor.get(l.anchor_id) ?? [];
  list.push(l.event_id);
  eventsOfAnchor.set(l.anchor_id, list);
}
for (const [aid, kind] of kindOf) {
  if (kind !== "event") continue;
  const evs = eventsOfAnchor.get(aid) ?? [];
  const others = new Set<string>();
  for (const e of evs) for (const x of anchorsOfEvent.get(e) ?? []) if (x !== aid) others.add(x);
  const arr = [...others];
  for (const other of arr) bump(aid, other, "same-event");
}

// ③ same-person：跟同一个人一起出现过的锚点之间
for (const [aid, kind] of kindOf) {
  if (kind !== "person") continue;
  const evs = eventsOfAnchor.get(aid) ?? [];
  if (evs.length < 3) continue; // 偶尔一起出现过不算关系
  const others = new Set<string>();
  for (const e of evs) for (const x of anchorsOfEvent.get(e) ?? []) if (x !== aid) others.add(x);
  const arr = [...others];
  for (let i = 0; i < arr.length; i += 1) {
    for (let j = i + 1; j < arr.length; j += 1) bump(arr[i]!, arr[j]!, "same-person");
  }
}

// ④ 写库：一对一行，类型取优先级最高的
const PRIORITY: Record<string, number> = {
  supersede: 5,
  "co-occur": 4,
  "same-event": 3,
  "same-person": 2,
  scene: 1,
};

// 每个锚点的度上限：只留权重最高的 20 条
const DEGREE_CAP = 20;
const ranked = [...evidence.entries()].map(([key, types]) => {
  const [a, b] = key.split("\u0000") as [string, string];
  let best = "co-occur";
  let bestScore = -1;
  let total = 0;
  for (const [t, c] of types) {
    total += c;
    const score = (PRIORITY[t] ?? 0) * 1000 + c;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return { a, b, best, total };
});
const degree = new Map<string, number>();
ranked.sort((x, y) => y.total - x.total);
const keptPairs = ranked.filter((e) => {
  const da = degree.get(e.a) ?? 0;
  const db2 = degree.get(e.b) ?? 0;
  if (da >= DEGREE_CAP || db2 >= DEGREE_CAP) return false;
  degree.set(e.a, da + 1);
  degree.set(e.b, db2 + 1);
  return true;
});

db.prepare("DELETE FROM edges").run();
const ins = db.prepare(
  "INSERT OR REPLACE INTO edges(src, dst, relation, weight, last_reinforced) VALUES(?,?,?,?,?)",
);

const counts = new Map<string, number>();
const now = Date.now();
for (const e of keptPairs) {
  const weight = Math.min(3, 1 + Math.log2(1 + e.total));
  ins.run(e.a, e.b, e.best, Number(weight.toFixed(2)), now);
  counts.set(e.best, (counts.get(e.best) ?? 0) + 1);
}

console.log("");
console.log("═══ 改后 ═══");
console.log(`  边总数 ${keptPairs.length}（原始候选 ${evidence.size}，度上限 ${DEGREE_CAP}）`);
console.log("  按类型：");
for (const [t, c] of [...counts.entries()].sort((x, y) => y[1] - x[1])) {
  console.log(`    ${t}：${c}`);
}
db.close();
