// 行为层与「自我修改」的真实数据
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, statSync } from "node:fs";
import { loadBotConfig } from "../src/bot/config.ts";
import { loadTuning } from "../src/tuning.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { buildTools } from "../src/tools/index.ts";

const cfg = loadBotConfig() as unknown as Record<string, unknown>;
const tune = loadTuning("data");

console.log("=== 行为开关（bot.json）===");
for (const k of ["autonomyEnabled", "autonomyMinutes", "autonomyIdleMinutes", "autonomyHours", "thinkEnabled", "thinkIdleSeconds", "thinkChance", "proactiveEnabled", "proactiveIdleMinutes", "proactiveDailyLimit", "phonePlayEnabled", "phonePlayChance", "dailyBudgetYuan"]) {
  console.log(`  ${k} = ${JSON.stringify(cfg[k])}`);
}

console.log("\n=== 调参（tuning.json）===");
console.log("  " + JSON.stringify(tune));

console.log("\n=== 工具总数 ===");
const { BotService } = await import("../src/bot/service.ts");
const { copyFileSync, rmSync } = await import("node:fs");
for (const f of ["data/tmp-bh.db", "data/tmp-bh.db-wal", "data/tmp-bh.db-shm"]) if (existsSync(f)) rmSync(f);
copyFileSync("data/memory.db", "data/tmp-bh.db");
const svc = new BotService({ ...cfg, memoryDb: "data/tmp-bh.db" } as never, { deliverText: async () => ({ ok: true, text: "桩" }) });
const names = svc.toolRegistry().schema().map((t) => String((t as { function?: { name?: string } }).function?.name ?? ""));
console.log(`  ${names.length} 个`);
console.log("  " + names.join("、"));
svc.close();
for (const f of ["data/tmp-bh.db", "data/tmp-bh.db-wal", "data/tmp-bh.db-shm"]) if (existsSync(f)) rmSync(f);

console.log("\n=== 她可以改自己的文件 ===");
for (const f of ["data/persona.md", "data/speech-rules.md", "data/extract-rules.md", "data/affect-words.json", "data/tuning.json", "data/self.md"]) {
  if (!existsSync(f)) {
    console.log(`  ${f} —— 不存在`);
    continue;
  }
  const st = statSync(f);
  const text = readFileSync(f, "utf8");
  console.log(`  ${f}  ${text.length} 字  ${(st.size / 1024).toFixed(1)} KB  改于 ${new Date(st.mtimeMs).toLocaleString("zh-CN", { hour12: false })}`);
}

console.log("\n=== 今天的日志统计 ===");
const log = existsSync("data/logs/bot.log") ? readFileSync("data/logs/bot.log", "utf8") : "";
const today = new Date().toISOString().slice(0, 10);
const lines = log.split("\n").filter((l) => l.includes(today) || l.includes("T03:") || l.includes("T02:"));
const count = (pat: string) => lines.filter((l) => l.includes(pat)).length;
console.log(`  [think] 走神记录：${count("[think]")} 条`);
console.log(`  [speak] 主动开口：${count("[speak] 发到")} 条`);
console.log(`  [autonomy] 自主活动：${count("[autonomy]")} 条`);
console.log(`  [tool] 工具调用：${count("[tool]")} 次`);
const sample = lines.filter((l) => l.includes("[think]")).slice(-3);
console.log("  最近三条走神：");
for (const s of sample) console.log("    " + s.slice(0, 110));
