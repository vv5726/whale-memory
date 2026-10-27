// 走神为什么越来越少开口：统计结果分布 + 看 thoughts.json 里被解析成 none 的
import { readFileSync, existsSync } from "node:fs";

const log = existsSync("data/logs/bot.log") ? readFileSync("data/logs/bot.log", "utf8") : "";
const lines = log.split("\n").filter((l) => l.includes("[think]"));

const bucket = new Map<string, number>();
for (const l of lines) {
  const m = /\[think\]\s*(.*)$/.exec(l);
  if (!m) continue;
  let reason = m[1]!.trim();
  reason = reason.replace(/想起「[^」]*」，?/, "想起X，");
  reason = reason.replace(/\d+/g, "N");
  bucket.set(reason, (bucket.get(reason) ?? 0) + 1);
}
console.log(`[think] 总条数：${lines.length}`);
for (const [k, v] of [...bucket.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(v).padStart(4)} × ${k.slice(0, 70)}`);
}

// 时间分布：最近 24 小时按小时
const byHour = new Map<string, { total: number; spoke: number }>();
for (const l of lines) {
  const m = /^(\d{4}-\d\d-\d\dT\d\d)/.exec(l);
  if (!m) continue;
  const h = m[1]!;
  const cur = byHour.get(h) ?? { total: 0, spoke: 0 };
  cur.total += 1;
  if (l.includes("找他说话")) cur.spoke += 1;
  byHour.set(h, cur);
}
console.log("\n按小时（总 / 开口）：");
for (const [h, v] of [...byHour.entries()].sort()) console.log(`  ${h}  ${String(v.total).padStart(3)} / ${v.spoke}`);

// thoughts.json：解析出来的渠道
if (existsSync("data/thoughts.json")) {
  const arr = JSON.parse(readFileSync("data/thoughts.json", "utf8")) as Array<{ anchor?: string; channel?: string; goal?: string; at?: number }>;
  console.log(`\nthoughts.json 共 ${arr.length} 条，最近 12 条：`);
  for (const t of arr.slice(-12)) {
    const when = t.at ? new Date(t.at).toLocaleString("zh-CN", { hour12: false }) : "?";
    console.log(`  ${when} | ${String(t.channel).padEnd(8)} | ${String(t.goal ?? "").slice(0, 42)} | ${t.anchor}`);
  }
  const byCh = new Map<string, number>();
  for (const t of arr) byCh.set(String(t.channel), (byCh.get(String(t.channel)) ?? 0) + 1);
  console.log("  渠道分布：" + [...byCh.entries()].map(([k, v]) => `${k}=${v}`).join("  "));
}
