/** 结构变了之后，逐项检查依赖锚点/边的代码是否需要改 */
import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const one = (sql: string): number => Number(db.prepare(sql).get()?.c ?? 0);

console.log("═══ 1. 检索是否会被 legacy 锚点污染 ═══");
const legacyLinked = one(
  "SELECT COUNT(*) AS c FROM event_anchors ea JOIN anchors a ON a.id = ea.anchor_id WHERE a.kind = 'legacy'",
);
console.log(`  挂在 legacy 锚点上的记忆：${legacyLinked} 条（应为 0）`);

console.log("");
console.log("═══ 2. 走神用的 randomAnchor ═══");
const walkable = one(
  "SELECT COUNT(*) AS c FROM (SELECT a.id FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id GROUP BY a.id HAVING COUNT(*) > 0)",
);
const walkableLegacy = one(
  "SELECT COUNT(*) AS c FROM (SELECT a.id FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id WHERE a.kind = 'legacy' GROUP BY a.id HAVING COUNT(*) > 0)",
);
console.log(`  可用来走神的锚点：${walkable} 个（其中 legacy ${walkableLegacy} 个）`);

console.log("");
console.log("═══ 3. 关系类型分布 ═══");
for (const r of db.prepare("SELECT relation, COUNT(*) AS c FROM edges GROUP BY relation").all() as Array<{
  relation: string;
  c: number;
}>) {
  console.log(`  ${r.relation}：${r.c}`);
}

console.log("");
console.log("═══ 4. 检索用的激活信号来源 ═══");
const activate = one(
  "SELECT COUNT(*) AS c FROM event_anchors ea JOIN anchors a ON a.id = ea.anchor_id WHERE a.kind IN ('person','event','place')",
);
console.log(`  三类锚点的挂载：${activate} 条`);

console.log("");
console.log("═══ 5. 记忆分布 ═══");
console.log(`  总 ${one("SELECT COUNT(*) AS c FROM events WHERE archived = 0")} 条｜带 etype ${one("SELECT COUNT(*) AS c FROM events WHERE etype <> ''")} 条｜legacy ${one("SELECT COUNT(*) AS c FROM events WHERE stage = 'legacy'")} 条`);
db.close();
