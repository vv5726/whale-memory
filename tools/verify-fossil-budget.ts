// 验收：化石层不再被 token 预算卡住，只按条数（1,000,000）触发合并
import { existsSync, copyFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { consolidateTiers, totalTokens } from "../src/compress.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

const tmp = "data/tmp-fossil.db";
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(f)) rmSync(f);
copyFileSync("data/memory.db", tmp);
const db = new DatabaseSync(tmp);
const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);

// 模拟：把 1,200 条 compressed 推进化石层（相当于跑了十几天之后）
db.prepare(
  "UPDATE events SET tier='fossil', stage='fossilized', detail=NULL, cause=NULL, effect=NULL, archived=1 WHERE id IN (SELECT id FROM events WHERE tier='compressed' ORDER BY ts ASC LIMIT 1200)",
).run();
console.log(`模拟之后：detailed ${n("SELECT COUNT(*) AS n FROM events WHERE tier='detailed'")}｜compressed ${n("SELECT COUNT(*) AS n FROM events WHERE tier='compressed'")}｜fossil ${n("SELECT COUNT(*) AS n FROM events WHERE tier='fossil'")}`);

const before = { total: totalTokens(db), fossil: n("SELECT COUNT(*) AS n FROM events WHERE tier='fossil'") };
const cfg = { ...DEFAULT_CONFIG, contextBudgetTokens: 1_000_000 };
const r = consolidateTiers(db, cfg, Date.now());
const after = { total: totalTokens(db), fossil: n("SELECT COUNT(*) AS n FROM events WHERE tier='fossil'") };

console.log(`\nconsolidateTiers 结果：${JSON.stringify(r)}`);
console.log(`化石条数 ${before.fossil} → ${after.fossil}｜总 token ${before.total} → ${after.total}`);
console.log(r.mergedFossils === 0 ? "✓ 化石层没被合并（因为远没到 100 万条）" : `✗ 意外合并了 ${r.mergedFossils} 次`);

// 再验证：把「总 token」推到超过 200 万，也不该触发化石合并
db.prepare("UPDATE events SET size_tokens = 4000 WHERE tier = 'fossil'").run();
console.log(`\n把化石每条改成 4,000 token（总 ${totalTokens(db).toLocaleString()}，远超 1M 预算）`);
const r2 = consolidateTiers(db, cfg, Date.now());
console.log(`结果：${JSON.stringify(r2)}`);
console.log(r2.mergedFossils === 0 ? "✓ 照样没合并 —— 化石层已经不吃 token 预算了" : `✗ 还是被合并了 ${r2.mergedFossils} 次`);

db.close();
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(f)) rmSync(f);
