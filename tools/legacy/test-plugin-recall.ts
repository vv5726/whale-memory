import { recallContext } from "../plugin/dsh-whale-memory/lib/recall.mjs";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/memory.db");

for (const q of ["小雨是什么意思", "我妈那次手术结果还好吗", "记忆结构怎么做的", "今天看了什么视频"]) {
  const block = recallContext(db, q, { limit: 3 });
  console.log(`\n=== 问：${q}`);
  console.log(block ? block.split("\n").map((l) => `  ${l.slice(0, 110)}`).join("\n") : "  （没有相关记忆）");
}
db.close();
