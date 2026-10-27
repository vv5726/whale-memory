/**
 * 重建锚点网络（按新规则：只留 人 / 事 / 环境）。
 *
 * 步骤：
 *   ① 备份数据库
 *   ② 把 theme / thing 里的锚点标成 legacy（不删，方便对照），挂载全摘掉
 *   ③ 每条记忆：留全部 person + 最多 3 个 event/place（环境）
 *   ④ 关系边全部重算：一对锚点只留一行，权重按共现次数饱和
 *   ⑤ 打印前后对比
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../src/db.ts";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-net-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("data/memory.db", join(dir, "memory.db"));
console.log(`① 备份 → ${dir}/memory.db`);

const db = openDb("data/memory.db");
const one = (sql: string): number => Number(db.prepare(sql).get()?.c ?? 0);

const before = {
  anchors: one("SELECT COUNT(*) AS c FROM anchors"),
  links: one("SELECT COUNT(*) AS c FROM event_anchors"),
  edges: one("SELECT COUNT(*) AS c FROM edges"),
};
console.log(`② 改前：锚点 ${before.anchors}｜挂载 ${before.links}｜边 ${before.edges}`);

// ③ 词类锚点降级
const demoted = db
  .prepare("UPDATE anchors SET kind = 'legacy' WHERE kind IN ('theme','thing')")
  .run();
console.log(`③ 降级 theme/thing 锚点：${Number(demoted.changes ?? 0)} 个`);

// ④ 摘掉所有挂在 legacy 上的关系
const unlinked = db
  .prepare("DELETE FROM event_anchors WHERE anchor_id IN (SELECT id FROM anchors WHERE kind = 'legacy')")
  .run();
console.log(`④ 摘掉 legacy 挂载：${Number(unlinked.changes ?? 0)} 条`);

// ⑤ 每条记忆最多留 3 个非人锚点
const events = db.prepare("SELECT id FROM events WHERE archived = 0").all() as Array<{ id: string }>;
let trimmed = 0;
for (const e of events) {
  const rows = db
    .prepare(
      `SELECT ea.anchor_id AS aid, ea.weight AS w, ea.rowid AS rid, a.kind AS kind
       FROM event_anchors ea JOIN anchors a ON a.id = ea.anchor_id WHERE ea.event_id = ?`,
    )
    .all(e.id) as Array<{ aid: string; w: number; rid: number; kind: string }>;
  const persons = rows.filter((r) => r.kind === "person");
  const others = rows.filter((r) => r.kind !== "person").sort((a, b) => Number(b.w) - Number(a.w) || Number(a.rid) - Number(b.rid));
  for (const d of others.slice(3)) {
    db.prepare("DELETE FROM event_anchors WHERE event_id = ? AND anchor_id = ?").run(e.id, d.aid);
    trimmed += 1;
  }
}
console.log(`⑤ 每条最多留 3 个非人锚点：摘掉 ${trimmed} 条`);

// ⑥ 边全部重算：一对锚点一行，权重按共现饱和
db.prepare("DELETE FROM edges").run();

const linksNow = db
  .prepare("SELECT event_id, anchor_id FROM event_anchors")
  .all() as Array<{ event_id: string; anchor_id: string }>;
const byEvent = new Map<string, string[]>();
for (const l of linksNow) {
  const list = byEvent.get(l.event_id) ?? [];
  list.push(l.anchor_id);
  byEvent.set(l.event_id, list);
}

const pairCount = new Map<string, number>();
for (const anchors of byEvent.values()) {
  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) {
      const [a, b] = [anchors[i]!, anchors[j]!].sort();
      const key = `${a}\u0000${b}`;
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }
  }
}

const ins = db.prepare(
  "INSERT OR REPLACE INTO edges(src, dst, relation, weight, last_reinforced) VALUES(?,?,?,?,?)",
);
const now = Date.now();
let edges = 0;
for (const [key, c] of pairCount) {
  const [a, b] = key.split("\u0000") as [string, string];
  // 饱和：1 次≈1.0，3 次≈1.7，10 次≈2.3，封顶 3
  const weight = Math.min(3, 1 + Math.log2(1 + c));
  ins.run(a, b, "co-occur", Number(weight.toFixed(2)), now);
  edges += 1;
}

console.log("");
console.log("═══ 改后 ═══");
console.log(`  锚点 ${one("SELECT COUNT(*) AS c FROM anchors")}（其中 legacy ${one("SELECT COUNT(*) AS c FROM anchors WHERE kind = 'legacy'")}）`);
for (const r of db.prepare("SELECT kind, COUNT(*) AS c FROM anchors GROUP BY kind ORDER BY c DESC").all() as Array<{
  kind: string;
  c: number;
}>) {
  console.log(`    ${r.kind}：${r.c}`);
}
console.log(`  挂载 ${one("SELECT COUNT(*) AS c FROM event_anchors")}`);
console.log(`  边 ${edges}（一对一行，relation=co-occur）`);

console.log("");
console.log("  挂得最多的锚点：");
for (const r of db
  .prepare("SELECT a.name, a.kind, COUNT(*) AS c FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id GROUP BY a.id ORDER BY c DESC LIMIT 8")
  .all() as Array<{ name: string; kind: string; c: number }>) {
  console.log(`    ${r.name}（${r.kind}）：${r.c}`);
}

db.close();
