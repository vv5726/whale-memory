/**
 * 补上「事锚点」：
 *   ① 以后抽取时，从事件标题生成一个 event 锚点并挂上
 *   ② 已经抽好的 243 条，按标题补出来
 *   ③ 关系边重算（一对一行）
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../src/db.ts";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-eventanchor-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("data/memory.db", join(dir, "memory.db"));
copyFileSync("src/llm/extract-v3.ts", join(dir, "extract-v3.ts"));
console.log(`① 备份 → ${dir}`);

// ② 以后抽取时也挂「事」锚点
{
  const p = "src/llm/extract-v3.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("eventAnchorsFromTitle")) {
    s = s.replace(
      'import { sceneAnchorFor } from "../scene-anchor.ts";',
      'import { sceneAnchorFor, eventAnchorFor } from "../scene-anchor.ts";',
    );
    s = s.replace(
      "    try {\n      const scene = sceneAnchorFor(",
      "    try {\n      // 事锚点：从标题长出来。没有它，锚点网络里就没有「事情」这一层。\n      const ev = eventAnchorFor(db, title);\n      if (ev) linkEventAnchor(db, row.id, ev, 1.5);\n    } catch (err) {\n      console.log(\"  [v3] 挂事锚点失败：\" + (err instanceof Error ? err.message : String(err)));\n    }\n    try {\n      const scene = sceneAnchorFor(",
    );
    writeFileSync(p, s, "utf8");
    console.log("② 抽取代码已加事锚点");
  } else console.log("② 已有");
}

// ③ 给已抽好的补上
const db = openDb("data/memory.db");
const { eventAnchorFor } = await import("../src/scene-anchor.ts");

const rows = db
  .prepare("SELECT id, title FROM events WHERE etype <> '' AND archived = 0")
  .all() as Array<{ id: string; title: string }>;

let linked = 0;
const ins = db.prepare(
  "INSERT INTO event_anchors(event_id, anchor_id, weight) VALUES(?,?,?) ON CONFLICT(event_id, anchor_id) DO UPDATE SET weight = MAX(weight, excluded.weight)",
);
for (const r of rows) {
  const a = eventAnchorFor(db, String(r.title));
  if (!a) continue;
  ins.run(r.id, a, 1.5);
  linked += 1;
}
console.log(`③ 给 ${linked} 条记忆补了事锚点`);

// ④ 边重算
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
const insEdge = db.prepare(
  "INSERT OR REPLACE INTO edges(src, dst, relation, weight, last_reinforced) VALUES(?,?,?,?,?)",
);
for (const [k, c] of pairs) {
  const [a, b] = k.split("\u0000") as [string, string];
  insEdge.run(a, b, "co-occur", Number(Math.min(3, 1 + Math.log2(1 + c)).toFixed(2)), Date.now());
}
console.log(`④ 边重算：${pairs.size} 条`);

const kinds = db.prepare("SELECT kind, COUNT(*) AS c FROM anchors GROUP BY kind ORDER BY c DESC").all() as Array<{
  kind: string;
  c: number;
}>;
console.log("");
console.log("锚点分布：");
for (const k of kinds) console.log(`  ${k.kind}：${k.c}`);

console.log("");
console.log("事锚点最多的几个：");
for (const r of db
  .prepare(
    "SELECT a.name, COUNT(*) AS c FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id WHERE a.kind = 'event' GROUP BY a.id ORDER BY c DESC LIMIT 6",
  )
  .all() as Array<{ name: string; c: number }>) {
  console.log(`  ${r.name}：${r.c} 条`);
}
db.close();
