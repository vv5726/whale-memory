import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const one = (sql: string): number => Number(db.prepare(sql).get()?.c ?? 0);

// ① 「群聊」这类泛名不管什么 kind，都停掉
const names = ["群聊", "私聊"];
for (const n of names) {
  const a = db.prepare("SELECT id, kind FROM anchors WHERE name = ?").get(n) as { id: string; kind: string } | undefined;
  if (!a) {
    console.log(`  「${n}」不存在`);
    continue;
  }
  db.prepare("DELETE FROM event_anchors WHERE anchor_id = ?").run(a.id);
  db.prepare("DELETE FROM edges WHERE src = ? OR dst = ?").run(a.id, a.id);
  db.prepare("UPDATE anchors SET kind = 'legacy' WHERE id = ?").run(a.id);
  console.log(`  停用「${n}」（原 kind=${a.kind}）`);
}

// ② 边重算 + 度上限 20
db.prepare("DELETE FROM edges").run();
const links = db.prepare("SELECT event_id, anchor_id FROM event_anchors").all() as Array<{
  event_id: string;
  anchor_id: string;
}>;
const byEvent = new Map<string, string[]>();
for (const l of links) {
  const list = byEvent.get(l.event_id) ?? [];
  list.push(l.anchor_id);
  byEvent.set(l.event_id, list);
}
const pairs = new Map<string, number>();
for (const anchors of byEvent.values()) {
  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) {
      const [a, b] = [anchors[i]!, anchors[j]!].sort();
      const k = `${a}\u0000${b}`;
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
  }
}
const ranked = [...pairs.entries()].sort((x, y) => y[1] - x[1]);
const degree = new Map<string, number>();
const CAP = 20;
const ins = db.prepare(
  "INSERT OR REPLACE INTO edges(src, dst, relation, weight, last_reinforced) VALUES(?,?,?,?,?)",
);
let kept = 0;
for (const [k, c] of ranked) {
  const [a, b] = k.split("\u0000") as [string, string];
  const da = degree.get(a) ?? 0;
  const dbq = degree.get(b) ?? 0;
  if (da >= CAP || dbq >= CAP) continue;
  degree.set(a, da + 1);
  degree.set(b, dbq + 1);
  ins.run(a, b, "co-occur", Number(Math.min(3, 1 + Math.log2(1 + c)).toFixed(2)), Date.now());
  kept += 1;
}

console.log("");
console.log("═══ 改后 ═══");
for (const r of db.prepare("SELECT kind, COUNT(*) AS c FROM anchors GROUP BY kind ORDER BY c DESC").all() as Array<{
  kind: string;
  c: number;
}>) {
  console.log(`  ${r.kind}：${r.c}`);
}
console.log(`  挂载 ${one("SELECT COUNT(*) AS c FROM event_anchors")}｜边 ${kept}（候选 ${pairs.size}，上限 ${CAP}）`);

console.log("");
console.log("  挂载最多的锚点：");
for (const r of db
  .prepare("SELECT a.name, a.kind, COUNT(*) AS c FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id GROUP BY a.id ORDER BY c DESC LIMIT 8")
  .all() as Array<{ name: string; kind: string; c: number }>) {
  console.log(`    ${r.name}（${r.kind}）：${r.c}`);
}
db.close();
