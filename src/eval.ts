import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { MemoryConfig, SleepStats, Tier } from "./types.ts";
import { openDb, resetDb, rowToEvent, tierTotals } from "./db.ts";
import { ensureSeedAnchors, ingestTurns, type TurnInput } from "./extract.ts";
import { sleep } from "./sleep.ts";
import { describeEvent, recall } from "./recall.ts";
import { dereference } from "./cold.ts";
import { dayKeyToTs } from "./util.ts";

export interface Probe {
  id: string;
  query: string;
  expect: string[];
  note?: string;
}

export interface ProbeResult {
  id: string;
  query: string;
  note: string;
  hit: boolean;
  rank: number | null;
  tier: Tier | null;
  matched: string | null;
  viaAffect: boolean;
  viaWake: boolean;
  existsInDb: boolean;
  topTitles: string[];
}

export interface EvalReport {
  budget: number;
  days: number;
  events: number;
  probes: ProbeResult[];
  hitRate: number;
  hitByTier: Record<string, number>;
  wakeRecovered: number;
  lostFacts: number;
  finalTotals: Record<string, { count: number; tokens: number }>;
  sleepStats: SleepStats[];
  durationMs: number;
}

export function seedFromFile(db: DatabaseSync, path: string): number {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    anchors: Array<{ name: string; kind: string; aliases?: string[] }>;
  };
  return ensureSeedAnchors(db, parsed.anchors);
}

export function readDataset(path: string): TurnInput[] {
  const lines = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.map((line) => {
    const row = JSON.parse(line) as TurnInput;
    return { day: row.day, role: row.role, text: row.text };
  });
}

export function readProbes(path: string): Probe[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { probes: Probe[] };
  return parsed.probes;
}

/** 一天一睡：模拟「当天很清晰，睡一觉就只剩印象」的真实节奏。 */
export function runScenario(
  db: DatabaseSync,
  cfg: MemoryConfig,
  turns: TurnInput[],
  onSleep?: (stats: SleepStats, day: string) => void,
): SleepStats[] {
  const byDay = new Map<string, TurnInput[]>();
  for (const t of turns) {
    if (!byDay.has(t.day)) byDay.set(t.day, []);
    byDay.get(t.day)!.push(t);
  }
  const days = [...byDay.keys()].sort();
  const stats: SleepStats[] = [];
  for (const day of days) {
    ingestTurns(db, byDay.get(day)!);
    // 睡眠发生在当天夜里，因此 nowTs 取当天中午之后 8 小时
    const st = sleep(db, cfg, { nowTs: dayKeyToTs(day) + 8 * 3600_000 });
    stats.push(st);
    onSleep?.(st, day);
  }
  return stats;
}

export function runProbes(db: DatabaseSync, cfg: MemoryConfig, probes: Probe[], nowTs: number): ProbeResult[] {
  const allEvents = db
    .prepare("SELECT * FROM events")
    .all()
    .map((r) => rowToEvent(r as Record<string, unknown>));

  return probes.map((p) => {
    const r = recall(db, cfg, p.query, { nowTs });

    const factualTexts = r.factual.map((c) => describeEvent(c.event));
    let hit = false;
    let rank: number | null = null;
    let tier: Tier | null = null;
    let matched: string | null = null;

    for (let i = 0; i < factualTexts.length; i += 1) {
      const hitWord = p.expect.find((w) => factualTexts[i].includes(w));
      if (hitWord) {
        hit = true;
        rank = i + 1;
        tier = r.factual[i].event.tier;
        matched = hitWord;
        break;
      }
    }

    const affectText = r.affective ? describeEvent(r.affective.event) + r.affective.event.affect.summary : "";
    const viaAffect = p.expect.some((w) => affectText.includes(w));
    const viaWake = r.coldHints.some((h) => {
      const full = dereference(db, h.address);
      return Boolean(full && p.expect.some((x) => full.rawDetail.includes(x) || full.gist.includes(x)));
    });

    const existsInDb = allEvents.some((e) =>
      p.expect.some(
        (w) =>
          e.title.includes(w) ||
          (e.detail ?? "").includes(w) ||
          (e.cause ?? "").includes(w) ||
          (e.effect ?? "").includes(w) ||
          (e.coreFragment ?? "").includes(w) ||
          e.affect.summary.includes(w),
      ),
    );

    return {
      id: p.id,
      query: p.query,
      note: p.note ?? "",
      hit,
      rank,
      tier,
      matched,
      viaAffect,
      viaWake,
      existsInDb,
      topTitles: r.factual.map((c) => c.event.title).slice(0, 3),
    };
  });
}

export function summarize(
  cfg: MemoryConfig,
  days: number,
  probes: ProbeResult[],
  sleepStats: SleepStats[],
  db: DatabaseSync,
  durationMs: number,
): EvalReport {
  const hitByTier: Record<string, number> = { detailed: 0, compressed: 0, fossil: 0, none: 0 };
  for (const p of probes) {
    if (p.hit) hitByTier[p.tier ?? "none"] += 1;
    else hitByTier.none += 1;
  }
  const events = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
  return {
    budget: cfg.contextBudgetTokens,
    days,
    events,
    probes,
    hitRate: probes.length === 0 ? 0 : probes.filter((p) => p.hit).length / probes.length,
    hitByTier,
    wakeRecovered: probes.filter((p) => p.viaWake && !p.hit).length,
    lostFacts: probes.filter((p) => !p.existsInDb).length,
    finalTotals: tierTotals(db),
    sleepStats,
    durationMs,
  };
}

export interface EvalOptions {
  dbPath: string;
  datasetPath: string;
  probesPath: string;
  seedsPath: string;
  cfg: MemoryConfig;
}

/** 完整跑一遍：清库 → 种锚点 → 逐日摄取+睡眠 → 跑探针。 */
export function runFullEval(opts: EvalOptions): { report: EvalReport; db: DatabaseSync } {
  const started = Date.now();
  const db = openDb(opts.dbPath);
  resetDb(db);
  seedFromFile(db, opts.seedsPath);
  const turns = readDataset(opts.datasetPath);
  const stats = runScenario(db, opts.cfg, turns);
  const probes = readProbes(opts.probesPath);
  const lastDay = turns[turns.length - 1]?.day ?? "2026-10-12";
  const nowTs = dayKeyToTs(lastDay) + 8 * 3600_000;
  const results = runProbes(db, opts.cfg, probes, nowTs);
  const days = new Set(turns.map((t) => t.day)).size;
  const report = summarize(opts.cfg, days, results, stats, db, Date.now() - started);
  return { report, db };
}

