/**
 * 记忆地平线外推。
 *
 * 问题：「这套东西能把记忆拉多长？」
 * 做法：把 10 天数据集按天循环重放成一条长timeline，每天睡一觉，
 *      在固定检查点统计各层覆盖的时间跨度。
 *
 * 用法：node tools/forecast.ts [预算] [模拟天数]
 *   例：node tools/forecast.ts 1000000 360
 */
import { DEFAULT_CONFIG, withOverrides } from "../src/config.ts";
import { openDb, rowToEvent, tierTotals } from "../src/db.ts";
import { ingestTurns } from "../src/extract.ts";
import { seedFromFile, readDataset } from "../src/eval.ts";
import { sleep } from "../src/sleep.ts";
import type { MemoryConfig } from "../src/types.ts";

const budget = Number(process.argv[2] ?? 1_000_000);
const totalDays = Number(process.argv[3] ?? 360);
const DENSITY = Number(process.argv[4] ?? 1); // 每天对话量倍数，模拟更密集的聊天

const DB = "data/forecast.db";
const cfg: MemoryConfig = withOverrides(DEFAULT_CONFIG, { contextBudgetTokens: budget });

const db = openDb(DB);
db.exec(
  "DELETE FROM events; DELETE FROM event_anchors; DELETE FROM edges; DELETE FROM turns; DELETE FROM anchors; DELETE FROM cold_archive; DELETE FROM mood_state; DELETE FROM sleep_runs;",
);
seedFromFile(db, "data/seed-anchors.json");

const turns = readDataset("eval/dataset.jsonl");
const byDay = new Map<string, typeof turns>();
for (const t of turns) {
  if (!byDay.has(t.day)) byDay.set(t.day, []);
  byDay.get(t.day)!.push(t);
}
const baseDays = [...byDay.keys()].sort();
const start = Date.UTC(2024, 0, 1, 12);

function ymd(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

interface Snapshot {
  day: number;
  events: number;
  tokens: number;
  detailed: { count: number; tokens: number; reachDays: number };
  compressed: { count: number; tokens: number; reachDays: number };
  fossil: { count: number; tokens: number; reachDays: number };
}

const snapshots: Snapshot[] = [];
const startedAt = Date.now();

let simDay = 0;
outer: for (let cycle = 0; ; cycle += 1) {
  for (const baseDay of baseDays) {
    if (simDay >= totalDays) break outer;
    const ts = start + simDay * 86_400_000;
    const day = ymd(ts);
    const batch = [];
    for (let k = 0; k < DENSITY; k += 1) {
      for (const t of byDay.get(baseDay)!) batch.push({ day, role: t.role, text: t.text });
    }
    ingestTurns(db, batch);
    sleep(db, cfg, { nowTs: ts + 8 * 3600_000 });
    simDay += 1;

    if (simDay % 30 === 0 || simDay === 1) {
      const now = ts + 8 * 3600_000;
      const rows = db.prepare("SELECT * FROM events").all().map((r) => rowToEvent(r as Record<string, unknown>));
      const reach = (tier: string) => {
        const ages = rows.filter((e) => e.tier === tier).map((e) => (now - e.ts) / 86_400_000);
        return ages.length === 0 ? 0 : Math.round(Math.max(...ages));
      };
      const totals = tierTotals(db);
      snapshots.push({
        day: simDay,
        events: rows.length,
        tokens: totals.detailed.tokens + totals.compressed.tokens + totals.fossil.tokens,
        detailed: { ...totals.detailed, reachDays: reach("detailed") },
        compressed: { ...totals.compressed, reachDays: reach("compressed") },
        fossil: { ...totals.fossil, reachDays: reach("fossil") },
      });
      if (simDay % 90 === 0) {
        process.stdout.write(`  … 已模拟 ${simDay} 天（${Math.round((Date.now() - startedAt) / 1000)}s）\n`);
      }
    }
  }
}

const elapsed = Math.round((Date.now() - startedAt) / 1000);
console.log(`\n预算 ${budget.toLocaleString()} token　每天 ${DENSITY}× 对话量　模拟 ${simDay} 天，耗时 ${elapsed}s\n`);

console.log("天数    事件  占用token     清晰(条/覆盖天)      压缩(条/覆盖天)      化石(条/覆盖天)");
for (const s of snapshots) {
  if (s.day > totalDays) continue;
  console.log(
    [
      String(s.day).padStart(4),
      String(s.events).padStart(5),
      s.tokens.toLocaleString().padStart(11),
      `${String(s.detailed.count).padStart(4)} 条 / ${String(s.detailed.reachDays).padStart(4)} 天`.padStart(21),
      `${String(s.compressed.count).padStart(4)} 条 / ${String(s.compressed.reachDays).padStart(4)} 天`.padStart(21),
      `${String(s.fossil.count).padStart(4)} 条 / ${String(s.fossil.reachDays).padStart(5)} 天`.padStart(21),
    ].join("  "),
  );
}

const last = snapshots[snapshots.length - 1];
if (last) {
  const perDayEvents = last.events / last.day;
  console.log("");
  console.log(`事件密度：${perDayEvents.toFixed(2)} 条/天　单条平均 ${Math.round(last.tokens / Math.max(1, last.events))} token`);
  console.log(`地平线：清晰 ≈ 最近 ${last.detailed.reachDays} 天　压缩 ≈ 到 ${last.compressed.reachDays} 天前　化石 ≈ 到 ${last.fossil.reachDays} 天前`);
  console.log(`外推：按此密度，${(budget / Math.max(1, last.tokens) * last.fossil.reachDays / 365).toFixed(1)} 年量级的记忆还能维持「有影子」`);
}
