// 验收 A 组合并：工具数/schema 大小、每个合并工具的各 action 能不能跑
import { existsSync, copyFileSync, rmSync } from "node:fs";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

for (const f of ["data/tmp-a.db", "data/tmp-a.db-wal", "data/tmp-a.db-shm"]) {
  if (existsSync(f)) rmSync(f);
}
copyFileSync("data/memory.db", "data/tmp-a.db");
const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/tmp-a.db" });
const reg = svc.toolRegistry();
if (!reg) {
  console.log("没有工具表");
  process.exit(1);
}
const schema = reg.schema();
const json = JSON.stringify(schema);
console.log(`工具总数 ${schema.length}｜schema ${json.length} 字｜≈ ${Math.round(json.length / 2.8)} token`);

const gone = ["persona_read", "persona_write", "persona_reset", "speech_rules_read", "speech_rules_write", "speech_rules_add", "think_prompt_read", "think_prompt_write", "think_prompt_reset", "think_knobs_read", "think_knobs_write", "group_policy_read", "group_policy_write", "can_dm_list", "can_dm_set", "can_dm_sync", "data_files_list", "data_file_read", "data_file_write", "extract_rules_read", "extract_rules_write", "extract_rules_add", "extract_prompt_read", "extract_prompt_write", "extract_prompt_reset", "extract_how"];
const names = new Set(schema.map((t) => t.function.name));
const still = gone.filter((n) => names.has(n));
console.log("旧工具名还在的:", still.length === 0 ? "无 ✓" : still.join(", "));
for (const n of ["persona", "speech", "think", "group_policy", "can_dm", "data_file", "extract"]) {
  console.log(`新工具 ${n}:`, names.has(n) ? "在 ✓" : "缺 ✗");
}

const call = async (name: string, args: Record<string, unknown>) => {
  const r = await reg.call(name, args);
  const first = String(r.text ?? "").split("\n")[0].slice(0, 90);
  console.log(`  ${name}(${JSON.stringify(args)}) → ok=${r.ok} ${first}`);
};

console.log("\n=== 各 action 冒烟 ===");
await call("persona", { action: "get" });
await call("speech", { action: "get" });
await call("think", { action: "knobs_get" });
await call("think", { action: "prompt_get" });
await call("group_policy", { action: "get" });
await call("can_dm", { action: "list" });
await call("data_file", { action: "list" });
await call("data_file", { action: "read", path: "tuning.json" });
await call("extract", { action: "rules_get" });
await call("extract", { action: "prompt_get" });
await call("extract", { action: "how" });
await call("speech", { action: "nonsense" });

svc.close();
for (const f of ["data/tmp-a.db", "data/tmp-a.db-wal", "data/tmp-a.db-shm"]) {
  if (existsSync(f)) rmSync(f);
}
