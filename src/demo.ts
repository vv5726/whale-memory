import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { DEFAULT_CONFIG, withOverrides } from "./config.ts";
import { openDb, tierTotals } from "./db.ts";
import { describeEvent, recall } from "./recall.ts";
import { dereference } from "./cold.ts";
import { linkIdentity, ensureAnchor } from "./anchors.ts";
import { exportMarkdown, renderStatusTable } from "./export.ts";
import { runFullEval, readDataset, seedFromFile } from "./eval.ts";
import { ingestTurns } from "./extract.ts";
import { sleep } from "./sleep.ts";
import { dayKeyToTs, padEnd } from "./util.ts";
import type { EvalReport } from "./eval.ts";
import type { SleepStats } from "./types.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEMO_DB = join(ROOT, "data", "demo.db");
const SEEDS = join(ROOT, "data", "seed-anchors.json");
const DATASET = join(ROOT, "eval", "dataset.jsonl");
const PROBES = join(ROOT, "eval", "probes.json");

// 演示用很小的上下文预算，让三层结构真的出现；生产按模型上下文设，例如 1M
const DEMO_CFG = withOverrides(DEFAULT_CONFIG, { contextBudgetTokens: 1200 });

function line(char = "─", n = 78): string {
  return char.repeat(n);
}

function banner(title: string): void {
  console.log("");
  console.log(line("═"));
  console.log(`  ${title}`);
  console.log(line("═"));
}

function tierBar(stats: SleepStats): string {
  const total = stats.totalTokens || 1;
  return (["detailed", "compressed", "fossil"] as const)
    .map((t) => {
      const share = stats.tiers[t].tokens / total;
      return `${t[0].toUpperCase()}${"█".repeat(Math.round(share * 24))}`;
    })
    .join(" ");
}

function anchorCount(db: ReturnType<typeof openDb>): number {
  return Number(db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c ?? 0);
}

function main(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${DEMO_DB}${suffix}`);
    } catch {
      // 文件不存在就算了
    }
  }

  banner("1. 建库 + 种锚点（别名归一：老王/王哥/建国 → 王建国）");
  const db = openDb(DEMO_DB);
  const anchors = seedFromFile(db, SEEDS);
  console.log(`   ${anchors} 个锚点已就位，数据库 ${DEMO_DB}`);
  console.log(
    `   上下文预算：${DEMO_CFG.contextBudgetTokens} token（演示刻意调小；生产按模型上下文设，如 1M → 0.3M 算「最近」）`,
  );

  banner("2. 逐日摄取 + 每天睡一觉（白天只记，晚上才整理）");
  const turns = readDataset(DATASET);
  const byDay = new Map<string, typeof turns>();
  for (const t of turns) {
    if (!byDay.has(t.day)) byDay.set(t.day, []);
    byDay.get(t.day)!.push(t);
  }
  const days = [...byDay.keys()].sort();
  for (const day of days) {
    ingestTurns(db, byDay.get(day)!);
    const st = sleep(db, DEMO_CFG, { nowTs: dayKeyToTs(day) + 8 * 3600_000 });
    console.log(
      `   ${day}  新事件 +${String(st.eventsExtracted).padStart(2)}  降级 ${st.degradedDetailed2Compressed}/${st.degradedCompressed2Fossil}  合并 ${st.mergedFossils}  占用 ${String(st.totalTokens).padStart(4)}  ${tierBar(st)}`,
    );
  }

  banner("3. 睡完之后的水位");
  const totals = tierTotals(db);
  console.log(
    renderStatusTable(totals, DEMO_CFG.contextBudgetTokens, {
      detailed: DEMO_CFG.detailedQuota,
      compressed: DEMO_CFG.compressedQuota,
    }),
  );

  banner("4. 三年后再问起来（事实通道确定性，情绪通道概率抽样）");
  const nowTs = dayKeyToTs(days[days.length - 1]) + 8 * 3600_000;
  const queries = [
    "王建国那两千块钱还了吗",
    "妈妈的手术结果怎么样",
    "云南的约定还算数吗",
    "大学宿舍楼下有什么",
    "林溪考研考得如何",
  ];
  let firstColdAddress = "";
  for (const q of queries) {
    const r = recall(db, DEMO_CFG, q, { nowTs, sessionId: "demo" });
    console.log("");
    console.log(`   Q: ${q}`);
    console.log(`   种子：${r.seeds.map((s) => s.name).join("、") || "（无锚点，走字面线索）"}`);
    r.factual.slice(0, 3).forEach((c, i) => {
      console.log(`   ${i + 1}. [${c.breakdown.total.toFixed(2)} ${c.event.tier}] ${describeEvent(c.event).slice(0, 56)}`);
    });
    if (r.coldHints.length > 0) {
      firstColdAddress ||= r.coldHints[0].address;
      console.log(`   ~ 底片地址（不读正文）：${r.coldHints[0].address}　${r.coldHints[0].gist.slice(0, 28)}`);
    }
    if (r.affective) {
      console.log(
        `   ♡ 浮现：${r.affective.viaAnchor ? `想到${r.affective.viaAnchor}，` : ""}${r.affective.event.affect.summary}（p=${r.affective.probability}）`,
      );
    }
  }

  banner("5. 冷存储：平时只存地址，要用才 deref");
  if (firstColdAddress) {
    const full = dereference(db, firstColdAddress);
    console.log(`   上面给出的那个地址，背后是这样一条记忆：${firstColdAddress}`);
    console.log(`   主库状态：${full?.liveTier ?? "已不在主库，只剩底片"}`);
    console.log(`   地址 ${firstColdAddress.length} 字符；deref 之后才拿到正文：${(full?.rawDetail ?? "").replace(/\n/g, " / ").slice(0, 60)}`);
  }
  const coldRows = db.prepare("SELECT address, gist FROM cold_archive LIMIT 3").all();
  console.log(`   共 ${db.prepare("SELECT COUNT(*) AS c FROM cold_archive").get()?.c} 条底片，例如：`);
  for (const row of coldRows) console.log(`     ${String(row.address)}　${String(row.gist).slice(0, 30)}`);

  banner("6. 同一性合并：100% 关联的两个锚点会真的并成一个");
  const wjg = db.prepare("SELECT id FROM anchors WHERE name = '王建国'").get();
  if (wjg) {
    const boss = ensureAnchor(db, "王总", "person", nowTs);
    linkIdentity(db, String(wjg.id), boss, 1.0, nowTs);
    const before = anchorCount(db);
    const merged = sleep(db, DEMO_CFG, { nowTs });
    console.log(`   建立「王总 = 王建国（weight 1.0）」后睡一觉`);
    console.log(`   锚点 ${before} → ${anchorCount(db)}（合并 ${merged.mergedAnchors} 个）`);
    const after = recall(db, DEMO_CFG, "王总上次说的那件事", { nowTs, sessionId: "demo" });
    console.log(`   用「王总」再问，仍然能连到王建国的事：${after.factual[0] ? describeEvent(after.factual[0].event).slice(0, 40) : "（无）"}`);
  }

  banner("7. 强制叫醒：睡眠中途可以被打断，状态保持完整");
  let step = 0;
  const interrupted = sleep(db, DEMO_CFG, {
    nowTs,
    shouldWake: () => {
      step += 1;
      return step > 2;
    },
  });
  console.log(`   停在步骤：${interrupted.interruptedAtStep}`);
  console.log(`   状态：${db.prepare("SELECT status FROM sleep_runs WHERE id = ?").get(interrupted.runId)?.status}`);
  const resumed = sleep(db, DEMO_CFG, { nowTs });
  console.log(`   再睡一次就跑完了：${resumed.interruptedAtStep ?? "done"}，占用 ${resumed.totalTokens} token`);

  banner("8. 上下文预算曲线：忘多少，取决于给了多少空间");
  const runAt = (budget: number) => {
    const cfg = withOverrides(DEFAULT_CONFIG, { contextBudgetTokens: budget });
    return runFullEval({
      dbPath: join(ROOT, "data", "eval.db"),
      datasetPath: DATASET,
      probesPath: PROBES,
      seedsPath: SEEDS,
      cfg,
    }).report;
  };

  console.log(
    `${padEnd("预算", 8)}${padEnd("清/压/化", 12)}${padEnd("召回率", 9)}${padEnd("说不清", 9)}${padEnd("彻底丢失", 10)}底片地址救回`,
  );
  let detail: EvalReport | null = null;
  for (const budget of [650, 1200, 2400, 1000000]) {
    const report = runAt(budget);
    const t = report.finalTotals;
    if (budget === 1200) detail = report;
    console.log(
      `${padEnd(String(budget), 8)}${padEnd(`${t.detailed.count}/${t.compressed.count}/${t.fossil.count}`, 12)}${padEnd(`${(report.hitRate * 100).toFixed(1)}%`, 9)}${padEnd(String(report.hitByTier.none - report.lostFacts), 9)}${padEnd(String(report.lostFacts), 10)}${report.wakeRecovered}`,
    );
  }

  if (detail) {
    console.log("");
    console.log("   budget=1200 时的逐条明细：");
    console.log(`${padEnd("探针", 6)}${padEnd("命中", 5)}${padEnd("名次", 5)}${padEnd("所在层", 12)}${padEnd("情绪", 5)}${padEnd("底片", 7)}问题`);
    for (const p of detail.probes) {
      console.log(
        `${padEnd(p.id, 6)}${padEnd(p.hit ? "✓" : "·", 5)}${padEnd(p.rank === null ? "-" : String(p.rank), 5)}${padEnd(p.tier ?? (p.existsInDb ? "有印象，说不清" : "彻底遗忘"), 12)}${padEnd(p.viaAffect ? "✓" : "", 5)}${padEnd(p.viaWake ? "✓" : "", 7)}${p.query}`,
      );
    }
  }

  banner("9. 导出人可读快照");
  const out = join(ROOT, "data", "memory.md");
  const res = exportMarkdown(db, out);
  console.log(`   ${res.events} 条记忆 → ${out}（${(res.bytes / 1024).toFixed(1)} KB）`);
  console.log("");
}

main();
