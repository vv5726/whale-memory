// 把被全局限流删掉的边从备份补回来（只补 edges，不动新产生的对话/记忆）
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const db = new DatabaseSync("data/memory.db");
if (!existsSync("data/backup-before-edge-prune.db")) {
  console.log("没有备份，退出");
  process.exit(1);
}
db.exec("ATTACH DATABASE 'data/backup-before-edge-prune.db' AS bak");

const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
console.log(`现在 edges ${n("SELECT COUNT(*) AS n FROM main.edges")} 条，备份 ${n("SELECT COUNT(*) AS n FROM bak.edges")} 条`);
const missing = n("SELECT COUNT(*) AS n FROM bak.edges b WHERE NOT EXISTS (SELECT 1 FROM main.edges m WHERE m.src=b.src AND m.dst=b.dst AND m.relation=b.relation)");
console.log(`备份里有、现在没有的：${missing} 条`);

if (!APPLY) {
  console.log("（干跑；加 --apply 才补）");
  db.close();
  process.exit(0);
}

db.exec("INSERT OR IGNORE INTO main.edges(src, dst, relation, weight, last_reinforced) SELECT src, dst, relation, weight, last_reinforced FROM bak.edges");
console.log(`补完：edges ${n("SELECT COUNT(*) AS n FROM main.edges")} 条`);
db.exec("DETACH DATABASE bak");
db.close();
