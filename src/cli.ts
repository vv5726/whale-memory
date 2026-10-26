import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_CONFIG, withOverrides } from "./config.ts";
import { openDb, resetDb, tierTotals } from "./db.ts";
import { ingestTurns } from "./extract.ts";
import { sleepAsync, pendingTurns, lastSleepRun } from "./sleep.ts";
import { pingOllama } from "./llm/adapter.ts";
import { recall, describeEvent } from "./recall.ts";
import { dereference } from "./cold.ts";
import { exportMarkdown, renderStatusTable } from "./export.ts";
import { readDataset, runFullEval, seedFromFile } from "./eval.ts";
import { dayKeyToTs, padEnd } from "./util.ts";
import type { MemoryConfig } from "./types.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_DB = join(ROOT, "data", "memory.db");
const SEEDS = join(ROOT, "data", "seed-anchors.json");
const DATASET = join(ROOT, "eval", "dataset.jsonl");
const PROBES = join(ROOT, "eval", "probes.json");

/** 叫醒请求写成文件即可，任何进程都能发，包括另一个 shell。 */
function wakeFilePath(): string {
  return join(ROOT, "data", ".wake-request");
}

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i += 1;
      }
    } else positional.push(a);
  }
  return { positional, flags };
}

function cfgFromFlags(flags: Record<string, string | boolean>): MemoryConfig {
  const patch: Partial<MemoryConfig> = {};
  if (typeof flags.budget === "string") patch.contextBudgetTokens = Number(flags.budget);
  if (typeof flags.topk === "string") patch.factTopK = Number(flags.topk);
  if (typeof flags.temp === "string") patch.temperatureBase = Number(flags.temp);
  if (flags.extractor === "llm" || flags.extractor === "heuristic") patch.extractor = flags.extractor;
  if (typeof flags.model === "string") patch.llmModel = flags.model;
  if (typeof flags.base === "string") patch.llmBaseUrl = flags.base;
  return withOverrides(DEFAULT_CONFIG, patch);
}

function dbPathFromFlags(flags: Record<string, string | boolean>): string {
  return typeof flags.db === "string" ? flags.db : DEFAULT_DB;
}

const HELP = `whale-memory —— 人类式遗忘记忆原型

用法：
  node src/cli.ts init                       建库 + 种锚点
  node src/cli.ts ingest --file <jsonl>      写入原始对话（L0）
  node src/cli.ts sleep [--now YYYY-MM-DD]   跑一次睡眠整合（压缩 + 降级 + 心境）
  node src/cli.ts wake                       强制叫醒正在进行的睡眠
  node src/cli.ts recall --text "..."        检索一条记忆，看它怎么被想起来
  node src/cli.ts deref cold://<eventId>     显式读取一条冷存储底片
  node src/cli.ts status                     上下文水位与各层分布
  node src/cli.ts export --out memory.md     导出人可读快照
  node src/cli.ts eval                       完整场景 + 探针评估
  node src/cli.ts anchors                    看锚点图
  node src/cli.ts cold                       列冷存储地址（不读正文）
  node src/cli.ts pins [--approve <id>]      看待钉住的约定 / 批准超额的
  node src/cli.ts llm                        检查本地模型是否就绪

  模型相关：
  node src/cli.ts sleep --extractor llm --model qwen3:8b
  node src/cli.ts sleep --base replay:eval/llm-replay.json   （离线验证管道）

通用参数：
  --db <path>       数据库路径（默认 data/memory.db）
  --budget <n>      覆盖上下文预算（默认 ${DEFAULT_CONFIG.contextBudgetTokens} token）
  --json            机器可读输出（recall 支持）
`;

function ensureSeeds(db: DatabaseSync, flags: Record<string, string | boolean> = {}): void {
  // 只有显式传 --seed 才灌演示锚点；真实使用的锚点从对话里长
  if (flags.seed !== true) return;
  const count = Number(db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c ?? 0);
  if (count === 0) seedFromFile(db, SEEDS);
}

function cmdInit(flags: Record<string, string | boolean>): void {
  const path = dbPathFromFlags(flags);
  const db = openDb(path);
  if (flags.reset === true) resetDb(db);
  // 种子文件是可选的：发布仓库里不一定带 data/（里面有密钥和对话）。
  // 以前这里直接 seedFromFile，缺文件就 ENOENT 崩掉——新人 clone 下来第一条命令就死。
  let n = 0;
  try {
    n = seedFromFile(db, SEEDS);
  } catch {
    console.log(`（没有种子文件 ${SEEDS}，先用空锚点；锚点本来就会从对话里长出来）`);
  }
  console.log(`数据库：${path}`);
  console.log(`锚点种子：${n} 个`);
}

function cmdIngest(flags: Record<string, string | boolean>): void {
  const file = typeof flags.file === "string" ? flags.file : DATASET;
  const db = openDb(dbPathFromFlags(flags));
  ensureSeeds(db);
  const turns = readDataset(file);
  const n = ingestTurns(db, turns);
  console.log(`写入 ${n} 条原始对话，待整理：${pendingTurns(db)} 条`);
}

async function cmdSleep(flags: Record<string, string | boolean>): Promise<void> {
  const db = openDb(dbPathFromFlags(flags));
  ensureSeeds(db, flags);
  const cfg = cfgFromFlags(flags);
  const nowTs = typeof flags.now === "string" ? dayKeyToTs(flags.now) + 8 * 3600_000 : Date.now();
  const startedAt = Date.now();
  const wakePath = wakeFilePath();
  const stats = await sleepAsync(db, cfg, {
    nowTs,
    // 只认「这次睡眠开始之后」发出的叫醒请求，避免上一次的残留把这一次也打断
    shouldWake: () => existsSync(wakePath) && statSync(wakePath).mtimeMs > startedAt,
  });
  if (existsSync(wakePath)) rmSync(wakePath, { force: true });

  console.log(
    stats.interruptedAtStep
      ? `睡眠被叫醒（${stats.elapsedMs}ms，停在 ${stats.interruptedAtStep}）`
      : `睡眠完成（${stats.elapsedMs}ms，抽取器 ${cfg.extractor}）`,
  );
  if (stats.llm) {
    console.log(
      `  模型抽取：${stats.llm.days} 天 → ${stats.llm.inserted} 条事件（${(stats.llm.elapsedMs / 1000).toFixed(1)}s）　新锚点 ${stats.llm.newAnchors}　退回启发式 ${stats.llm.failed} 天　冻结复用 ${stats.llm.frozen} 天`,
    );
    if (stats.llm.fallbackDays.length > 0) {
      console.log(`  退回启发式的日期：${stats.llm.fallbackDays.join("、")}`);
    }
  }
  console.log(`  抽取事件 ${stats.eventsExtracted}　锚点 ${stats.anchorsTouched}　新边 ${stats.edgesFormed}　锚点合并 ${stats.mergedAnchors}`);
  console.log(
    `  清晰→压缩 ${stats.degradedDetailed2Compressed}　压缩→化石 ${stats.degradedCompressed2Fossil}　冷存储 ${stats.archived}　化石合并 ${stats.mergedFossils}`,
  );
  if (stats.deferredPins > 0 || stats.expiredPins > 0) {
    console.log(`  待审钉住 ${stats.deferredPins}　过期解除 ${stats.expiredPins}`);
  }
  console.log(`  上下文占用 ${stats.totalTokens} token`);
  console.log(`  心境：${stats.mood.label}（valence ${stats.mood.valence} / arousal ${stats.mood.arousal}）`);
}

function cmdRecall(flags: Record<string, string | boolean>): void {
  const text = typeof flags.text === "string" ? flags.text : "";
  if (!text) throw new Error("需要 --text");
  const db = openDb(dbPathFromFlags(flags));
  const cfg = cfgFromFlags(flags);
  const result = recall(db, cfg, text, {
    sessionId: typeof flags.session === "string" ? flags.session : "cli",
    seedOverride: typeof flags.seed === "string" ? Number(flags.seed) : undefined,
  });

  if (flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`查询：${result.query}`);
  console.log(
    `种子锚点：${result.seeds.length === 0 ? "（无，走字面/情绪通道）" : result.seeds.map((s) => `${s.name}«${s.alias}»`).join("、")}`,
  );
  if (result.activation.length > 0) {
    console.log(
      `扩散激活：${result.activation
        .slice(0, 6)
        .map((a) => `${a.name}(${a.score.toFixed(2)}${a.hop > 0 ? `←${a.hop}跳` : ""})`)
        .join(" → ")}`,
    );
  }
  console.log("");
  console.log("事实通道（确定性，不许随机）");
  if (result.factual.length === 0) console.log("  （空）");
  result.factual.forEach((c, i) => {
    console.log(
      `  ${i + 1}. [${c.breakdown.total.toFixed(2)}] (${c.event.tier}) ${describeEvent(c.event).slice(0, 60)}`,
    );
  });
  console.log("");
  console.log(`情绪通道（温度 ${result.randomness.temperature}，seed ${result.randomness.seed}）`);
  result.probabilityTable.forEach((t) => {
    console.log(`  p=${t.probability.toFixed(3)}  ${t.title}`);
  });
  if (result.affective) {
    console.log(
      `  → 抽中：${result.affective.viaAnchor ? `想到${result.affective.viaAnchor}，` : ""}${result.affective.event.affect.summary}`,
    );
  }
  if (result.coldHints.length > 0) {
    console.log("");
    console.log("冷存储地址（不读正文，省 token；要看细节用 deref）");
    result.coldHints.forEach((h) => console.log(`  - ${h.address}　${h.gist}`));
  }
  console.log("");
  console.log("——— 注入上下文的实际内容 ———");
  console.log(result.contextBlock);
  console.log(`——— 共 ${result.totalTokens} token ———`);
}

function cmdStatus(flags: Record<string, string | boolean>): void {
  const db = openDb(dbPathFromFlags(flags));
  const cfg = cfgFromFlags(flags);
  const totals = tierTotals(db);
  const total = Object.values(totals).reduce((a, t) => a + t.tokens, 0);
  const over = total > cfg.contextBudgetTokens;
  console.log(renderStatusTable(totals, cfg.contextBudgetTokens, { detailed: cfg.detailedQuota, compressed: cfg.compressedQuota }));
  console.log("");
  console.log(`上下文预算 ${cfg.contextBudgetTokens} token　实用 ${total}　${over ? "⚠ 超预算" : "✓ 在预算内"}`);
  const q = (sql: string) => Number(db.prepare(sql).get()?.c ?? 0);
  console.log(
    `待处理对话 ${pendingTurns(db)}　锚点 ${q("SELECT COUNT(*) AS c FROM anchors")}　边 ${q("SELECT COUNT(*) AS c FROM edges")}　冷存储 ${q("SELECT COUNT(*) AS c FROM cold_archive")}　钉住 ${q("SELECT COUNT(*) AS c FROM events WHERE pinned = 1")}`,
  );
  const last = db.prepare("SELECT started_at, finished_at, status FROM sleep_runs ORDER BY started_at DESC LIMIT 1").get();
  if (last) {
    const ms = last.finished_at ? Number(last.finished_at) - Number(last.started_at) : 0;
    console.log(`上次睡眠：${new Date(Number(last.started_at)).toISOString()} ${last.status}（${ms}ms）`);
  }
}

function cmdExport(flags: Record<string, string | boolean>): void {
  const db = openDb(dbPathFromFlags(flags));
  const out = typeof flags.out === "string" ? flags.out : join(ROOT, "data", "memory.md");
  const res = exportMarkdown(db, out);
  console.log(`已导出 ${res.events} 条记忆 → ${out}（${(res.bytes / 1024).toFixed(1)} KB）`);
}

function cmdAnchors(flags: Record<string, string | boolean>): void {
  const db = openDb(dbPathFromFlags(flags));
  const rows = db
    .prepare(
      `SELECT a.name, a.kind, a.hits, a.salience, COUNT(ea.event_id) AS events
       FROM anchors a LEFT JOIN event_anchors ea ON ea.anchor_id = a.id
       GROUP BY a.id ORDER BY a.hits DESC, events DESC`,
    )
    .all();
  console.log(`${padEnd("锚点", 14)}${padEnd("类型", 8)}${padEnd("触发", 6)}${padEnd("事件", 6)}显著度`);
  for (const r of rows) {
    console.log(
      `${padEnd(String(r.name), 14)}${padEnd(String(r.kind), 8)}${padEnd(String(r.hits), 6)}${padEnd(String(r.events), 6)}${Number(r.salience).toFixed(2)}`,
    );
  }
  const edges = db.prepare("SELECT src, dst, relation, weight FROM edges").all();
  if (edges.length > 0) {
    console.log("");
    console.log("边（这是联想的物理基础）");
    for (const e of edges.slice(0, 40)) {
      const name = (id: string) => String(db.prepare("SELECT name FROM anchors WHERE id = ?").get(id)?.name ?? id);
      console.log(`  ${name(String(e.src))} —${String(e.relation)}(${Number(e.weight).toFixed(1)})— ${name(String(e.dst))}`);
    }
  }
}

function cmdCold(flags: Record<string, string | boolean>): void {
  const db = openDb(dbPathFromFlags(flags));
  const rows = db.prepare("SELECT event_id, address, gist, raw_detail, archived_at FROM cold_archive ORDER BY archived_at DESC").all();
  console.log(`冷存储 ${rows.length} 条（不参与检索、不进上下文，按地址取用）`);
  for (const r of rows) {
    console.log(`  ${String(r.address)}　[${new Date(Number(r.archived_at)).toISOString().slice(0, 10)}] ${String(r.gist)}`);
  }
}

/** 显式读取底片：这是「真有需求才接入」的唯一入口。 */
function cmdDeref(flags: Record<string, string | boolean>, positional: string[]): void {
  const address = positional[1] ?? (typeof flags.address === "string" ? flags.address : "");
  if (!address) throw new Error("用法：node src/cli.ts deref cold://xxx");
  const db = openDb(dbPathFromFlags(flags));
  const row = dereference(db, address);
  if (!row) {
    console.error(`✗ 找不到地址 ${address}`);
    process.exitCode = 1;
    return;
  }
  console.log(`地址：${row.address}`);
  console.log(`摘要：${row.gist}`);
  console.log(`归档时间：${new Date(row.archivedAt).toISOString()}`);
  console.log(`主库状态：${row.liveTier ?? "已不在主库（只剩底片）"}`);
  console.log("——— 原始内容 ———");
  console.log(row.rawDetail);
}

/**
 * 强制叫醒。
 *
 * 把请求写成文件，正在睡的那个进程会在下一个步骤边界看到它、做完当前步就退出，
 * 状态保持完整，剩下的留到下次睡眠。睡眠期间来的消息不做任何特殊处理——按你说的，不理。
 */
function cmdWake(flags: Record<string, string | boolean>): void {
  const path = wakeFilePath();
  writeFileSync(path, JSON.stringify({ at: Date.now(), reason: String(flags.reason ?? "手动叫醒") }), "utf8");
  const db = openDb(dbPathFromFlags(flags));
  const last = lastSleepRun(db);
  console.log(`已发出叫醒请求 → ${path}`);
  if (!last) {
    console.log("（还没有睡眠记录）");
    return;
  }
  const age = Date.now() - last.startedAt;
  console.log(`最近一次睡眠：${last.status}（${age}ms 前开始）`);
  if (last.status === "running") {
    console.log("它会在当前步骤做完后停下，状态记为 interrupted。");
  } else {
    console.log("当前没有正在进行的睡眠，请求作废（下次睡眠开始时会清掉这个文件）。");
  }
}

function cmdPins(flags: Record<string, string | boolean>): void {
  const db = openDb(dbPathFromFlags(flags));
  if (flags.approve === true || typeof flags.approve === "string") {
    const id = typeof flags.approve === "string" ? flags.approve : "";
    const row = db.prepare("SELECT id, event_id FROM pending_pins WHERE status = 'pending' AND (id = ? OR event_id = ?)").get(id, id);
    if (!row) {
      console.error(`✗ 找不到待审的钉住请求：${id}`);
      process.exitCode = 1;
      return;
    }
    const nowTs = Date.now();
    const cfg = cfgFromFlags(flags);
    db.prepare("UPDATE events SET pinned = 1, pin_expires_at = ? WHERE id = ?").run(
      nowTs + cfg.pinnedTtlDays * 86_400_000,
      String(row.event_id),
    );
    db.prepare("UPDATE pending_pins SET status = 'approved' WHERE id = ?").run(String(row.id));
    console.log(`已批准：${String(row.event_id)} 现在被钉住（${cfg.pinnedTtlDays} 天后自动过期）`);
    return;
  }

  const pinned = db.prepare("SELECT id, day, title, pin_expires_at FROM events WHERE pinned = 1 ORDER BY day DESC").all();
  console.log(`已钉住 ${pinned.length} 条（有期限，过期自动降级）`);
  for (const p of pinned) {
    const exp = p.pin_expires_at ? new Date(Number(p.pin_expires_at)).toISOString().slice(0, 10) : "永久";
    console.log(`  [${String(p.day)}] ${String(p.title)}　到期 ${exp}`);
  }
  const pending = db.prepare("SELECT id, event_id, reason, created_at FROM pending_pins WHERE status = 'pending' ORDER BY created_at DESC").all();
  console.log("");
  console.log(`待审 ${pending.length} 条（命中约定模式但超了额度，需要人来定）`);
  for (const p of pending) {
    console.log(`  ${String(p.id)}　${String(p.reason)}`);
    console.log(`    → 批准：node src/cli.ts pins --approve ${String(p.id)}`);
  }
}

function cmdEval(flags: Record<string, string | boolean>): void {
  const cfg = cfgFromFlags(flags);
  const { report } = runFullEval({
    dbPath: dbPathFromFlags(flags),
    datasetPath: DATASET,
    probesPath: PROBES,
    seedsPath: SEEDS,
    cfg,
  });

  console.log(`评估：${report.days} 天 / ${report.events} 条记忆 / 预算 ${report.contextBudget} token / ${report.durationMs}ms`);
  console.log("");
  console.log(renderStatusTable(report.finalTotals, report.contextBudget, { detailed: cfg.detailedQuota, compressed: cfg.compressedQuota }));
  console.log("");
  console.log(`${padEnd("探针", 6)}${padEnd("命中", 6)}${padEnd("名次", 6)}${padEnd("所在层", 12)}${padEnd("情绪", 6)}${padEnd("冷归档", 8)}问题`);
  for (const p of report.probes) {
    console.log(
      `${padEnd(p.id, 6)}${padEnd(p.hit ? "✓" : "·", 6)}${padEnd(p.rank === null ? "-" : String(p.rank), 6)}${padEnd(p.tier ?? (p.existsInDb ? "有印象，说不清" : "彻底遗忘"), 12)}${padEnd(p.viaAffect ? "✓" : "", 6)}${padEnd(p.viaWake ? "✓" : "", 8)}${p.query}`,
    );
  }
  console.log("");
  console.log(`召回率 ${(report.hitRate * 100).toFixed(1)}%　按层：detailed ${report.hitByTier.detailed} / compressed ${report.hitByTier.compressed} / fossil ${report.hitByTier.fossil} / 未命中 ${report.hitByTier.none}`);
  console.log(`冷归档救回 ${report.wakeRecovered} 条　彻底丢失 ${report.lostFacts} 条`);
  const last = report.sleepStats[report.sleepStats.length - 1];
  if (last) {
    console.log(`最后一次睡眠：清晰→压缩 ${last.degradedDetailed2Compressed}，压缩→化石 ${last.degradedCompressed2Fossil}，冷归档 ${last.archived}，化石合并 ${last.mergedFossils}`);
  }
}

async function cmdLlm(flags: Record<string, string | boolean>): Promise<void> {
  const cfg = cfgFromFlags(flags);
  console.log(`抽取器：${cfg.extractor}　地址：${cfg.llmBaseUrl}　模型：${cfg.llmModel}`);
  if (cfg.llmBaseUrl.startsWith("replay:")) {
    console.log("当前是回放模式，不调真模型（用于离线验证管道）");
    return;
  }
  try {
    console.log(await pingOllama(cfg));
  } catch (err) {
    console.error(`✗ 连不上模型服务：${err instanceof Error ? err.message : String(err)}`);
    console.error("  Ollama 装好之后先跑：ollama serve，再 ollama pull qwen3:8b");
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseArgs(argv);
  const cmd = positional[0] ?? "help";

  switch (cmd) {
    case "init":
      cmdInit(flags);
      break;
    case "ingest":
      cmdIngest(flags);
      break;
    case "sleep":
      await cmdSleep(flags);
      break;
    case "recall":
      cmdRecall(flags);
      break;
    case "status":
      cmdStatus(flags);
      break;
    case "export":
      cmdExport(flags);
      break;
    case "eval":
      cmdEval(flags);
      break;
    case "anchors":
      cmdAnchors(flags);
      break;
    case "cold":
      cmdCold(flags);
      break;
    case "deref":
      cmdDeref(flags, positional);
      break;
    case "wake":
      cmdWake(flags);
      break;
    case "pins":
      cmdPins(flags);
      break;
    case "llm":
      await cmdLlm(flags);
      break;
    default:
      console.log(HELP);
  }
}

try {
  await main();
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  if (process.env.DEBUG) console.error(err);
  process.exitCode = 1;
}




