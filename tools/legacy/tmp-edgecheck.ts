// 4 万条边到底是什么：按关系类型、按年龄、按两端冷热分布
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/memory.db");
const now = Date.now();

const total = Number((db.prepare("SELECT COUNT(*) AS n FROM edges").get() as { n: number }).n);
console.log(`边总数 ${total}`);

console.log("\n=== 按 relation ===");
const rel = db.prepare("SELECT relation, COUNT(*) n, ROUND(AVG(weight),2) w, MIN(weight) mi, MAX(weight) ma FROM edges GROUP BY relation ORDER BY n DESC").all() as Array<{
  relation: string;
  n: number;
  w: number;
  mi: number;
  ma: number;
}>;
for (const r of rel) console.log(`  ${String(r.relation).padEnd(12)} ${String(r.n).padStart(6)} 条  weight 平均 ${r.w}（${r.mi}~${r.ma}）`);

console.log("\n=== 按「多久没被强化」 ===");
const buckets = [1, 6, 24, 72, 168, 720];
let prev = 0;
for (const h of buckets) {
  const n = Number(
    (db.prepare("SELECT COUNT(*) AS n FROM edges WHERE last_reinforced > ? AND last_reinforced <= ?").get(now - h * 3_600_000, now - prev * 3_600_000) as { n: number }).n,
  );
  console.log(`  ${String(prev).padStart(3)}~${String(h).padStart(4)} 小时前强化过：${String(n).padStart(6)} 条`);
  prev = h;
}
const older = Number((db.prepare("SELECT COUNT(*) AS n FROM edges WHERE last_reinforced <= ?").get(now - 720 * 3_600_000) as { n: number }).n);
console.log(`  >720 小时：${older} 条`);

console.log("\n=== 两端锚点是不是「冷」的（挂不上任何未归档记忆）===");
db.exec("CREATE TEMP TABLE IF NOT EXISTS hot_anchor AS SELECT DISTINCT ea.anchor_id AS id FROM event_anchors ea JOIN events e ON e.id = ea.event_id WHERE e.archived = 0");
const hot = Number((db.prepare("SELECT COUNT(*) AS n FROM hot_anchor").get() as { n: number }).n);
const anchors = Number((db.prepare("SELECT COUNT(*) AS n FROM anchors").get() as { n: number }).n);
console.log(`  热锚点 ${hot} / 全部 ${anchors}`);

const both = Number(
  (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM edges x WHERE NOT EXISTS (SELECT 1 FROM hot_anchor h WHERE h.id = x.src) AND NOT EXISTS (SELECT 1 FROM hot_anchor h WHERE h.id = x.dst)",
      )
      .get() as { n: number }
  ).n,
);
const one = Number(
  (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM edges x WHERE (EXISTS (SELECT 1 FROM hot_anchor h WHERE h.id = x.src)) <> (EXISTS (SELECT 1 FROM hot_anchor h WHERE h.id = x.dst))",
      )
      .get() as { n: number }
  ).n,
);
console.log(`  两端都冷：${both} 条 ｜ 一端冷：${one} 条 ｜ 两端都热：${total - both - one} 条`);

console.log("\n=== 如果按「weight × 新鲜度」排序，前 20% 的分数长什么样 ===");
const scored = db.prepare("SELECT weight, last_reinforced FROM edges").all() as Array<{ weight: number; last_reinforced: number }>;
const score = (w: number, ts: number) => w * Math.pow(0.5, Math.max(0, (now - ts) / 3_600_000) / 72);
const list = scored.map((x) => score(Number(x.weight), Number(x.last_reinforced))).sort((a, b) => b - a);
const cut = list[Math.floor(list.length * 0.2)] ?? 0;
console.log(`  第 20% 的分界值 = ${cut.toFixed(2)}（前 20% 最低这个分，剩下 ${(list.length * 0.8).toFixed(0)} 条都低于它）`);
console.log(`  中位数 ${(list[Math.floor(list.length / 2)] ?? 0).toFixed(2)}，最低 ${(list[list.length - 1] ?? 0).toFixed(2)}`);
db.close();
