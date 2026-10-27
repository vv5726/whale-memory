/** 全面核对：进程、库文件、工具读数、真实计数 */
import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { buildTools } from "../src/tools/index.ts";
import { existsSync, readdirSync } from "node:fs";

const cfg = loadBotConfig();

console.log("① 配置");
console.log(`   memoryDb = ${cfg.memoryDb}`);
console.log(`   sharedMemory = ${cfg.sharedMemory}`);

console.log("\n② 库文件");
for (const f of readdirSync("data").filter((x) => x.endsWith(".db"))) {
  console.log(`   data/${f}`);
}

console.log("\n③ 库里的真实数字（按配置打开）");
const db = openDb(cfg.memoryDb);
const raw = db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number };
const live = db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get() as { c: number };
const arch = db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 1").get() as { c: number };
const pend = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get() as { c: number };
console.log(`   总 ${raw.c}｜有效 ${live.c}｜归档 ${arch.c}｜待整理 ${pend.c}`);

console.log("\n④ 她调 memory_stats 会看到");
const t = buildTools(cfg, db);
const stats = await t.call("memory_stats", {});
console.log("   " + String(stats.text).split("\n").slice(0, 2).join(" / "));

console.log("\n⑤ 她调 memory_list 会看到");
const list = await t.call("memory_list", { limit: 3 });
console.log("   " + String(list.text).split("\n").slice(0, 2).join("\n   "));

db.close();
