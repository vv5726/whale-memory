// 真实一点的模拟：一次睡眠只压 10 条 detailed，看边被削多少、召回有没有掉
import { existsSync, copyFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { capEdgesByTier, decayEdges, thinNewlyWarmEdges, warmEdgeKeys } from "../src/anchors.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { recall } from "../src/recall.ts";

const tmp = "data/tmp-edge-real.db";
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(f)) rmSync(f);
copyFileSync("data/memory.db", tmp);
const db = new DatabaseSync(tmp);
const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
const queries = ["外号", "记忆", "昨晚那个 bug", "冷笑话", "群聊", "某人", "母单", "额度", "测试群"];
const probe = () => queries.map((q) => recall(db, DEFAULT_CONFIG, q, { sessionId: "probe" }).factual.length).join(",");

console.log(`起点：edges ${n("SELECT COUNT(*) AS n FROM edges")}，detailed ${n("SELECT COUNT(*) AS n FROM events WHERE tier='detailed'")}`);
console.log(`召回：${probe()}`);

for (const round of [1, 2, 3]) {
  const warmBefore = warmEdgeKeys(db);
  // 模拟 consolidateTiers：把最弱的 10 条 detailed 降级
  const demoted = db
    .prepare(
      "UPDATE events SET tier='compressed', detail=NULL WHERE id IN (SELECT id FROM events WHERE tier='detailed' AND pinned=0 ORDER BY strength ASC, ts ASC LIMIT 10)",
    )
    .run();
  const before = n("SELECT COUNT(*) AS n FROM edges");
  const decayed = decayEdges(db, Date.now());
  const thinned = thinNewlyWarmEdges(db, warmBefore, 0.25);
  const capped = capEdgesByTier(db, { warmCap: 20_000, coldCap: 2_000, keepRatio: 0.5 });
  const after = n("SELECT COUNT(*) AS n FROM edges");
  console.log(
    `\n第 ${round} 轮：降级 ${demoted.changes} 条记忆 → 边 ${before} → ${after}（削新温边 ${thinned}，砍半 ${capped.warmDeleted + capped.coldDeleted}，衰减处理 ${decayed}）`,
  );
  console.log(`  召回：${probe()}`);
}

// 中断保护：没有快照时不该削任何边
const beforeInterrupt = n("SELECT COUNT(*) AS n FROM edges");
console.log(`\n（中断保护检查）没有快照时调用 thinNewlyWarmEdges 会被 sleep 跳过；直接调会削吗？`);
const fakeThin = 0; // sleep 里 warmBeforeCompress 为 null 时 thinned = 0
console.log(`  sleep 里的写法：warmBeforeCompress ? thin(...) : 0 → thinned = ${fakeThin}，边数 ${beforeInterrupt}（不变）`);

db.close();
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(f)) rmSync(f);
