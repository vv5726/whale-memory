// 边的三条规则全验：分档半衰期（热15/温3/冷2）、超限砍半（20,000 / 50%）、热转温削到 25%
import { existsSync, copyFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { capEdgesByTier, decayEdges, thinNewlyWarmEdges, warmEdgeKeys } from "../src/anchors.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { recall } from "../src/recall.ts";

const tmp = "data/tmp-edgeall.db";
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(f)) rmSync(f);
copyFileSync("data/memory.db", tmp);
const db = new DatabaseSync(tmp);
const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);

const tierCounts = () => {
  const hot = n("SELECT COUNT(DISTINCT anchor_id) AS n FROM event_anchors ea JOIN events e ON e.id=ea.event_id WHERE e.archived=0 AND e.tier='detailed'");
  const warm = n("SELECT COUNT(DISTINCT anchor_id) AS n FROM event_anchors ea JOIN events e ON e.id=ea.event_id WHERE e.archived=0 AND e.tier='compressed'");
  const cold = n("SELECT COUNT(*) AS n FROM anchors") - n("SELECT COUNT(DISTINCT anchor_id) AS n FROM event_anchors ea JOIN events e ON e.id=ea.event_id WHERE e.archived=0");
  return { hot, warm, cold };
};

const queries = ["外号", "记忆", "昨晚那个 bug", "冷笑话", "群聊", "某人", "母单"];
const probe = () => queries.map((q) => recall(db, DEFAULT_CONFIG, q, { sessionId: "probe" }).factual.length).join(",");

console.log(`起点：edges ${n("SELECT COUNT(*) AS n FROM edges")} 条，锚点分层 ${JSON.stringify(tierCounts())}`);
console.log(`召回：${probe()}`);

// ① 分档半衰期：造三条 20 天没动的边，端点分别是热/温/冷
const pick = (tier: string) =>
  (
    db
      .prepare(
        "SELECT ea.anchor_id AS id FROM event_anchors ea JOIN events e ON e.id = ea.event_id WHERE e.archived = 0 AND e.tier = ? LIMIT 1",
      )
      .get(tier) as { id: string } | undefined
  )?.id ?? "";
const coldAnchor =
  (db.prepare("SELECT id FROM anchors WHERE id NOT IN (SELECT ea.anchor_id FROM event_anchors ea JOIN events e ON e.id=ea.event_id WHERE e.archived=0) LIMIT 1").get() as
    | { id: string }
    | undefined)?.id ?? "";
const aHot = pick("detailed");
const aWarm = pick("compressed");
const old = Date.now() - 20 * 86_400_000;
const mk = (src: string, dst: string, tag: string) =>
  db
    .prepare("INSERT OR REPLACE INTO edges(src,dst,relation,weight,last_reinforced) VALUES(?,?,?,3.0,?)")
    .run(src, dst, `test-${tag}`, old);
mk(aHot, aHot === aWarm ? pick("detailed") : aWarm, "hot"); // 热+热
mk(aWarm, aWarm === coldAnchor ? pick("compressed") : coldAnchor, "warm"); // 温+冷 → 取最旧 = 冷
mk(coldAnchor, coldAnchor, "cold");
console.log(`\n① 分档半衰期（三条边各重 3.0、20 天没动）：`);
decayEdges(db, Date.now());
for (const tag of ["hot", "warm", "cold"]) {
  const r = db.prepare("SELECT weight FROM edges WHERE relation = ?").get(`test-${tag}`) as { weight: number } | undefined;
  const got = r ? Number(r.weight) : 0;
  const exp = { hot: 3 * Math.pow(0.5, 20 / 15), warm: 3 * Math.pow(0.5, 20 / 3), cold: 3 * Math.pow(0.5, 20 / 2) }[tag] ?? 0;
  console.log(`  ${tag.padEnd(5)} 现在 ${got.toFixed(3)}｜按分档应为 ${exp.toFixed(3)} → ${Math.abs(got - exp) < 0.02 ? "✓" : "✗"}`);
}
db.prepare("DELETE FROM edges WHERE relation LIKE 'test-%'").run();

// ② 超限砍半（上限临时压到 5,000，keepRatio 0.5）
const before = n("SELECT COUNT(*) AS n FROM edges WHERE relation='same-day'");
const capped = capEdgesByTier(db, { warmCap: 5_000, coldCap: 2_000, keepRatio: 0.5 });
const after = n("SELECT COUNT(*) AS n FROM edges WHERE relation='same-day'");
console.log(`\n② 超限砍半（上限临时压到 5,000）：删 ${capped.warmDeleted + capped.coldDeleted}，same-day ${before} → ${after}`);
console.log(`  ${before > 5_000 ? (after >= Math.floor(before * 0.45) ? "✓ 大约留一半" : "✗ 留得太少") : "（没超线，未触发）"}`);
console.log(`  召回：${probe()}`);

// ③ 热转温削到 25%：先把 detailed 全压成 compressed，模拟一次"热转温"
const warmBefore = warmEdgeKeys(db);
const demoted = db.prepare("UPDATE events SET tier='compressed', detail=NULL WHERE tier='detailed'").run();
console.log(`\n③ 模拟热转温（${demoted.changes} 条 detailed → compressed）`);
const thinned = thinNewlyWarmEdges(db, warmBefore, 0.25);
const freshNow = warmEdgeKeys(db).size;
console.log(`  新变温的边削掉了 ${thinned} 条；现在温边 key 共 ${freshNow} 个`);
console.log(`  召回：${probe()}`);

db.close();
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(f)) rmSync(f);
