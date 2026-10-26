import type { DatabaseSync } from "node:sqlite";
import { dayKey } from "./util.ts";

/**
 * 每天花多少钱。
 *
 * 唯一还在拦它的东西——不是权限，是钱。
 * 算法很简单：记下每次调用用了多少 token，按单价折成钱，过了上限今天就不许再调模型。
 *
 * 单价可以在配置里改（DeepSeek 会调价，别写死）。
 */
export interface CostConfig {
  /** 每百万输入 token 多少钱 */
  inputPerMTok: number;
  /** 每百万输出 token 多少钱 */
  outputPerMTok: number;
  /** 每天最多花多少元；0 表示不限 */
  dailyBudgetYuan: number;
}

let dbRef: DatabaseSync | null = null;
let cfgRef: CostConfig = { inputPerMTok: 2, outputPerMTok: 8, dailyBudgetYuan: 5 };

export function initCost(db: DatabaseSync, cfg: CostConfig): void {
  dbRef = db;
  cfgRef = cfg;
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_cost (
      day TEXT PRIMARY KEY,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      cache_hit_tokens INTEGER NOT NULL DEFAULT 0,
      cache_miss_tokens INTEGER NOT NULL DEFAULT 0,
      calls INTEGER NOT NULL DEFAULT 0
    );
  `);
  // 老库补列（2026-10-26 加缓存统计）
  for (const col of ["cache_hit_tokens", "cache_miss_tokens"]) {
    try {
      const cols = db.prepare("PRAGMA table_info(daily_cost)").all().map((c) => String((c as { name?: string }).name ?? ""));
      if (!cols.includes(col)) db.exec(`ALTER TABLE daily_cost ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // 补不上就算了，记账失败不能影响回话
    }
  }
}

/** 记一次调用的用量 */
export function recordUsage(
  promptTokens: number,
  completionTokens: number,
  cacheHitTokens = 0,
  cacheMissTokens = 0,
): void {
  if (!dbRef) return;
  const day = dayKey(Date.now());
  try {
    dbRef
      .prepare(
        `INSERT INTO daily_cost (day, prompt_tokens, completion_tokens, cache_hit_tokens, cache_miss_tokens, calls)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(day) DO UPDATE SET
           prompt_tokens = prompt_tokens + excluded.prompt_tokens,
      cache_hit_tokens = cache_hit_tokens + excluded.cache_hit_tokens,
      cache_miss_tokens = cache_miss_tokens + excluded.cache_miss_tokens,
           completion_tokens = completion_tokens + excluded.completion_tokens,
           calls = calls + 1`,
      )
      .run(
      day,
      Math.max(0, Math.round(promptTokens)),
      Math.max(0, Math.round(completionTokens)),
      Math.max(0, Math.round(cacheHitTokens)),
      Math.max(0, Math.round(cacheMissTokens)),
    );
  } catch {
    // 记账失败不能影响回话
  }
}

export interface CostSnapshot {
  day: string;
  promptTokens: number;
  completionTokens: number;
  calls: number;
  /** 命中了多少次缓存（这些 token 按 1/10 价） */
  cacheHitTokens: number;
  cacheMissTokens: number;
  /** 缓存命中率 0-1 */
  cacheHitRate: number;
  /** 按缓存价重算的「真实」花费（上面的 yuan 仍是保守价，照旧用来卡预算） */
  yuanWithCache: number;
  yuan: number;
  budgetYuan: number;
  leftYuan: number;
  exhausted: boolean;
}

export function todayCost(): CostSnapshot {
  const day = dayKey(Date.now());
  if (!dbRef) {
    return {
      day,
      promptTokens: 0,
      completionTokens: 0,
      calls: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      cacheHitRate: 0,
      yuanWithCache: 0,
      yuan: 0,
      budgetYuan: cfgRef.dailyBudgetYuan,
      leftYuan: cfgRef.dailyBudgetYuan,
      exhausted: false,
    };
  }

  const row = dbRef
    .prepare("SELECT prompt_tokens, completion_tokens, calls, cache_hit_tokens, cache_miss_tokens FROM daily_cost WHERE day = ?")
    .get(day) as
    | { prompt_tokens: number; completion_tokens: number; calls: number; cache_hit_tokens: number; cache_miss_tokens: number }
    | undefined;

  const promptTokens = Number(row?.prompt_tokens ?? 0);
  const completionTokens = Number(row?.completion_tokens ?? 0);
  const cacheHitTokens = Number(row?.cache_hit_tokens ?? 0);
  const cacheMissTokens = Number(row?.cache_miss_tokens ?? 0);
  const yuan =
    (promptTokens / 1_000_000) * cfgRef.inputPerMTok + (completionTokens / 1_000_000) * cfgRef.outputPerMTok;
  // 缓存命中按 1/10 价（DeepSeek 的计价方式），只用来给她看真实账单；卡预算仍用上面的保守价
  const yuanWithCache =
    ((cacheHitTokens / 10 + Math.max(0, promptTokens - cacheHitTokens)) / 1_000_000) * cfgRef.inputPerMTok +
    (completionTokens / 1_000_000) * cfgRef.outputPerMTok;

  const budget = cfgRef.dailyBudgetYuan;
  return {
    day,
    promptTokens,
    completionTokens,
    calls: Number(row?.calls ?? 0),
    cacheHitTokens,
    cacheMissTokens,
    cacheHitRate: promptTokens > 0 ? Number((cacheHitTokens / promptTokens).toFixed(4)) : 0,
    yuanWithCache: Number(yuanWithCache.toFixed(4)),
    yuan: Number(yuan.toFixed(4)),
    budgetYuan: budget,
    leftYuan: budget > 0 ? Number(Math.max(0, budget - yuan).toFixed(4)) : Infinity,
    exhausted: budget > 0 && yuan >= budget,
  };
}
