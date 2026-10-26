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
      calls INTEGER NOT NULL DEFAULT 0
    );
  `);
}

/** 记一次调用的用量 */
export function recordUsage(promptTokens: number, completionTokens: number): void {
  if (!dbRef) return;
  const day = dayKey(Date.now());
  try {
    dbRef
      .prepare(
        `INSERT INTO daily_cost (day, prompt_tokens, completion_tokens, calls)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(day) DO UPDATE SET
           prompt_tokens = prompt_tokens + excluded.prompt_tokens,
           completion_tokens = completion_tokens + excluded.completion_tokens,
           calls = calls + 1`,
      )
      .run(day, Math.max(0, Math.round(promptTokens)), Math.max(0, Math.round(completionTokens)));
  } catch {
    // 记账失败不能影响回话
  }
}

export interface CostSnapshot {
  day: string;
  promptTokens: number;
  completionTokens: number;
  calls: number;
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
      yuan: 0,
      budgetYuan: cfgRef.dailyBudgetYuan,
      leftYuan: cfgRef.dailyBudgetYuan,
      exhausted: false,
    };
  }

  const row = dbRef
    .prepare("SELECT prompt_tokens, completion_tokens, calls FROM daily_cost WHERE day = ?")
    .get(day) as { prompt_tokens: number; completion_tokens: number; calls: number } | undefined;

  const promptTokens = Number(row?.prompt_tokens ?? 0);
  const completionTokens = Number(row?.completion_tokens ?? 0);
  const yuan =
    (promptTokens / 1_000_000) * cfgRef.inputPerMTok + (completionTokens / 1_000_000) * cfgRef.outputPerMTok;

  const budget = cfgRef.dailyBudgetYuan;
  return {
    day,
    promptTokens,
    completionTokens,
    calls: Number(row?.calls ?? 0),
    yuan: Number(yuan.toFixed(4)),
    budgetYuan: budget,
    leftYuan: budget > 0 ? Number(Math.max(0, budget - yuan).toFixed(4)) : Infinity,
    exhausted: budget > 0 && yuan >= budget,
  };
}
