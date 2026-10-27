// 真跑一次 sleepAsync（跳过抽取，不花钱），看整条流程会不会炸、统计对不对
import { existsSync, copyFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { sleepAsync } from "../src/sleep.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

const tmp = "data/tmp-sleepreal.db";
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(f)) rmSync(f);
copyFileSync("data/memory.db", tmp);
const db = new DatabaseSync(tmp);
const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);

console.log(`跑之前：edges ${n("SELECT COUNT(*) AS n FROM edges")}，detailed ${n("SELECT COUNT(*) AS n FROM events WHERE tier='detailed'")}，compressed ${n("SELECT COUNT(*) AS n FROM events WHERE tier='compressed'")}`);

const stats = await sleepAsync(db, { ...DEFAULT_CONFIG, contextBudgetTokens: 1_000_000 } as never, { skipExtract: true } as never);
const s = stats as unknown as Record<string, unknown>;
console.log("\n睡眠统计（关键字段）：");
for (const k of ["status", "interruptedAtStep", "edgesDecayed", "edgesPruned", "degradedDetailed2Compressed", "degradedCompressed2Fossil", "mergedFossils", "elapsedMs"]) {
  if (k in s) console.log(`  ${k}: ${JSON.stringify(s[k])}`);
}
console.log("\n跑之后：");
console.log(`  edges ${n("SELECT COUNT(*) AS n FROM edges")}，detailed ${n("SELECT COUNT(*) AS n FROM events WHERE tier='detailed'")}，compressed ${n("SELECT COUNT(*) AS n FROM events WHERE tier='compressed'")}，fossil ${n("SELECT COUNT(*) AS n FROM events WHERE tier='fossil'")}`);

const byRel = db.prepare("SELECT relation, COUNT(*) n FROM edges GROUP BY relation").all() as Array<{ relation: string; n: number }>;
console.log(`  边分布：${byRel.map((r) => `${r.relation}=${r.n}`).join("，")}`);
db.close();
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(f)) rmSync(f);
