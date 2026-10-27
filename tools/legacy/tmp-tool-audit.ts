// 审工具清单：数量、schema 大小、按家族分组、找近义/重复
import { existsSync, copyFileSync, rmSync } from "node:fs";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

for (const f of ["data/tmp-tools.db", "data/tmp-tools.db-wal", "data/tmp-tools.db-shm"]) {
  if (existsSync(f)) rmSync(f);
}
copyFileSync("data/memory.db", "data/tmp-tools.db");
const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/tmp-tools.db" });
const reg = svc.toolRegistry();
if (!reg) {
  console.log("没有工具表");
  process.exit(1);
}
const schema = reg.schema();
const json = JSON.stringify(schema);
console.log(`工具总数 ${schema.length}｜schema JSON ${json.length} 字｜≈ ${Math.round(json.length / 2.8)} token（每次请求都发一遍）`);

const rows = schema.map((t) => {
  const name = t.function.name;
  const desc = t.function.description ?? "";
  const props = Object.keys((t.function.parameters as { properties?: object })?.properties ?? {});
  const size = JSON.stringify(t).length;
  return { name, descLen: desc.length, props, size };
});

// 按前缀家族分组
const fam = new Map<string, typeof rows>();
for (const r of rows) {
  const key = r.name.includes("_") ? r.name.split("_")[0]! : r.name;
  if (!fam.has(key)) fam.set(key, []);
  fam.get(key)!.push(r);
}
console.log("\n=== 按前缀分组（按 schema 体积排）===");
const fams = [...fam.entries()]
  .map(([k, v]) => ({ k, v, size: v.reduce((n, r) => n + r.size, 0) }))
  .sort((a, b) => b.size - a.size);
for (const f of fams) {
  console.log(
    `${f.k.padEnd(12)} ${String(f.v.length).padStart(2)} 个  ${String(Math.round(f.size / 2.8)).padStart(5)} token  ${f.v.map((r) => r.name).join(", ")}`,
  );
}

console.log("\n=== 单个工具最贵 top 15 ===");
for (const r of [...rows].sort((a, b) => b.size - a.size).slice(0, 15)) {
  console.log(`  ${String(Math.round(r.size / 2.8)).padStart(4)} token  ${r.name.padEnd(24)} 描述 ${r.descLen} 字`);
}

svc.close();
for (const f of ["data/tmp-tools.db", "data/tmp-tools.db-wal", "data/tmp-tools.db-shm"]) {
  if (existsSync(f)) rmSync(f);
}
