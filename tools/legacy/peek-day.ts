import { openDb } from "../src/db.ts";

const day = process.argv[2] ?? "2024-03-02";
const db = openDb("data/cmp-llm.db");
const row = db.prepare("SELECT raw FROM llm_extractions WHERE day = ?").get(day) as { raw?: string } | undefined;
if (!row?.raw) {
  console.log("没有这一天的原始输出");
} else {
  console.log(row.raw.slice(0, 2000));
}
console.log("\n=== 入库的事件 ===");
for (const e of db.prepare("SELECT title, detail, cause, effect, core_fragment, size_tokens FROM events WHERE day = ?").all(day)) {
  console.log(JSON.stringify(e, null, 1));
}
