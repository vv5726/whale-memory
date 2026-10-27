// 重置今天的额度：把 daily_cost 今日那行清零（先备份、先打印原值）
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync } from "node:fs";

const day = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

const APPLY = process.argv.includes("--apply");

const bak = `data/backup-cost-reset-${day.replace(/-/g, "")}.db`;
if (APPLY && !existsSync(bak)) {
  copyFileSync("data/memory.db", bak);
  console.log(`备份：${bak}`);
}

const db = new DatabaseSync("data/memory.db");
const before = db.prepare("SELECT * FROM daily_cost WHERE day = ?").get(day);
console.log("今天 =", day);
console.log("重置前：", JSON.stringify(before ?? "(没有这一行)"));

if (before) {
  const yuan = (Number(before.prompt_tokens) / 1e6) * 0.5 + (Number(before.completion_tokens) / 1e6) * 8;
  console.log(`折合：prompt ${before.prompt_tokens} token / completion ${before.completion_tokens} / ${before.calls} 次调用 ≈ ${yuan.toFixed(2)} 元`);
}

if (APPLY) {
  db.prepare(
    "UPDATE daily_cost SET prompt_tokens = 0, completion_tokens = 0, cache_hit_tokens = 0, cache_miss_tokens = 0, calls = 0 WHERE day = ?",
  ).run(day);
  const after = db.prepare("SELECT * FROM daily_cost WHERE day = ?").get(day);
  console.log("重置后：", JSON.stringify(after));
} else {
  console.log("（干跑，没写；加 --apply 才真改）");
}
db.close();
