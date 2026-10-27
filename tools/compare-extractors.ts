/**
 * 两种抽取器的对照实验：同一批对话、同一套探针，只换抽取器。
 *
 * 用法：node tools/compare-extractors.ts [预算]
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, withOverrides } from "../src/config.ts";
import { openDb, rowToEvent, tierTotals } from "../src/db.ts";
import { ingestTurns } from "../src/extract.ts";
import { readDataset, readProbes, runProbes, seedFromFile, summarize } from "../src/eval.ts";
import { sleep, sleepAsync } from "../src/sleep.ts";
import { dayKeyToTs, padEnd } from "../src/util.ts";
import type { MemoryConfig } from "../src/types.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DATASET = join(ROOT, "eval", "dataset.jsonl");
const PROBES = join(ROOT, "eval", "probes.json");
const SEEDS = join(ROOT, "data", "seed-anchors.json");
const budget = Number(process.argv[2] ?? 1200);

const turns = readDataset(DATASET);
const byDay = new Map<string, typeof turns>();
for (const t of turns) {
  if (!byDay.has(t.day)) byDay.set(t.day, []);
  byDay.get(t.day)!.push(t);
}
const days = [...byDay.keys()].sort();
const lastTs = dayKeyToTs(days[days.length - 1]!) + 8 * 3600_000;

function clean(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${path}${suffix}`);
    } catch {
      // 不存在就算了
    }
  }
}

async function run(extractor: "heuristic" | "llm") {
  const path = join(ROOT, "data", `cmp-${extractor}.db`);
  clean(path);
  const db = openDb(path);
  seedFromFile(db, SEEDS);
  const cfg: MemoryConfig = withOverrides(DEFAULT_CONFIG, {
    contextBudgetTokens: budget,
    extractor,
    llmModel: "qwen3:8b",
  });

  const started = Date.now();
  for (const day of days) {
    ingestTurns(db, byDay.get(day)!);
    await sleepAsync(db, cfg, { nowTs: dayKeyToTs(day) + 8 * 3600_000 });
  }
  const elapsed = Date.now() - started;

  const results = runProbes(db, cfg, readProbes(PROBES), lastTs);
  const report = summarize(cfg, days.length, results, [], db, elapsed);
  const events = db.prepare("SELECT * FROM events").all().map((r) => rowToEvent(r as Record<string, unknown>));
  const anchors = Number(db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c ?? 0);
  const sizes = events.map((e) => e.sizeTokens);
  const avgSize = sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length);
  const withAffect = events.filter((e) => e.affect.tags.length > 0).length;
  db.close();
  return {
    extractor,
    events: events.length,
    anchors,
    avgSize: Math.round(avgSize),
    tokens: tierTotals(openDb(path)).detailed.tokens + 0,
    elapsed,
    hitRate: report.hitRate,
    hitByTier: report.hitByTier,
    lost: report.lostFacts,
    affectCoverage: withAffect / Math.max(1, events.length),
    probes: results,
  };
}

async function main(): Promise<void> {
  console.log(`对话 ${days.length} 天，上下文预算 ${budget} token\n`);
  const heuristic = await run("heuristic");
  const llm = await run("llm");

  const row = (label: string, a: string | number, b: string | number) =>
    `${padEnd(label, 16)}${padEnd(String(a), 18)}${b}`;

  console.log(row("指标", "规则版(heuristic)", "模型版(qwen3:8b)"));
  console.log(row("─".repeat(14), "─".repeat(16), "─".repeat(16)));
  console.log(row("事件条数", heuristic.events, llm.events));
  console.log(row("锚点数", heuristic.anchors, llm.anchors));
  console.log(row("单条平均 token", heuristic.avgSize, llm.avgSize));
  console.log(row("带情绪的条目", `${(heuristic.affectCoverage * 100).toFixed(0)}%`, `${(llm.affectCoverage * 100).toFixed(0)}%`));
  console.log(row("抽取耗时", `${(heuristic.elapsed / 1000).toFixed(1)}s`, `${(llm.elapsed / 1000).toFixed(1)}s`));
  console.log(row("探针召回率", `${(heuristic.hitRate * 100).toFixed(1)}%`, `${(llm.hitRate * 100).toFixed(1)}%`));
  console.log(row("彻底丢失", heuristic.lost, llm.lost));

  console.log("\n逐条探针对照（✓ 命中 / · 没想起 / ✗ 已丢失）");
  console.log(`${padEnd("探针", 6)}${padEnd("规则版", 10)}${padEnd("模型版", 10)}问题`);
  for (const [i, p] of llm.probes.entries()) {
    const h = heuristic.probes[i];
    const mark = (r: typeof p) => (r.hit ? `✓ 第${r.rank}名` : r.existsInDb ? "· 有印象" : "✗ 已丢失");
    console.log(`${padEnd(p.id, 6)}${padEnd(mark(h), 10)}${padEnd(mark(p), 10)}${p.query}`);
  }
}

await main();
