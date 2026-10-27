import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Tuning {
  /** 说话的温度：0 完全确定（每次都一样），1 很跳。抽取不用这个值 */
  replyTemperature: number;
  /** 抽取记忆时的温度：0 会写成模板，0.3 左右能写出具体的想法 */
  extractTemperature: number;
  /** 群里说话的相关性门槛：到了才回（0-1） */
  groupSpeakThreshold: number;
  /** 发了消息没人回，多久去判断一次（分钟） */
  silentCheckMinutes: number;
  /** 发了消息没人回，多久之后默认对方在忙、不再等（分钟） */
  silentGiveUpMinutes: number;
  /** 回话时最多调几轮工具。每轮都要把整段历史重发一遍，轮数是平方级的花钱 */
  replyRounds: number;
  /** 她自己活动时最多调几轮工具（走神 / 自主活动 / 计划提醒 / 主动开口） */
  actRounds: number;
  /** 新抽取（v3）：价值分低于这个数就不记。调高＝记得更少更准 */
  v3MinValue: number;
  /** 新抽取（v3）：一批最多记几条 */
  v3MaxEvents: number;
  /** 走神：两次走神之间最短隔多久（分钟） */
  thinkGapMinMinutes: number;
  /** 走神：两次走神之间最长隔多久（分钟） */
  thinkGapMaxMinutes: number;
  /** 走神：他说话之后安静多少秒才允许走神 */
  thinkIdleSeconds: number;
  /** 走神：任何活动（回话/工具/自主活动）后缓多少秒 */
  thinkSettleSeconds: number;
  /** 走神：到点后掷中的概率 */
  thinkChance: number;
  /** 计划做完后写成记忆时给几分（0-10）：高了不容易被压缩，低了更容易下沉 */
  planDoneMemoryValue: number;
}

const DEFAULTS: Tuning = {
  replyTemperature: 0.9,
  extractTemperature: 0.3,
  groupSpeakThreshold: 0.6,
  silentCheckMinutes: 3,
  silentGiveUpMinutes: 60,
  replyRounds: 8,
  actRounds: 6,
  v3MinValue: 3,
  v3MaxEvents: 8,
  thinkGapMinMinutes: 1.5,
  thinkGapMaxMinutes: 3.5,
  thinkIdleSeconds: 30,
  thinkSettleSeconds: 90,
  thinkChance: 0.85,
  planDoneMemoryValue: 6,
};

function fileOf(dataDir: string): string {
  return join(dataDir, "tuning.json");
}

export function loadTuning(dataDir: string): Tuning {
  try {
    const f = fileOf(dataDir);
    if (!existsSync(f)) return { ...DEFAULTS };
    const raw = JSON.parse(readFileSync(f, "utf8")) as Partial<Tuning>;
    return {
      replyTemperature: clamp(Number(raw.replyTemperature ?? DEFAULTS.replyTemperature), 0, 1.5),
      extractTemperature: clamp(Number(raw.extractTemperature ?? DEFAULTS.extractTemperature), 0, 1),
      groupSpeakThreshold: clamp(Number(raw.groupSpeakThreshold ?? DEFAULTS.groupSpeakThreshold), 0, 1),
      silentCheckMinutes: Math.max(1, Math.min(120, Number(raw.silentCheckMinutes ?? DEFAULTS.silentCheckMinutes))),
      silentGiveUpMinutes: Math.max(5, Math.min(1440, Number(raw.silentGiveUpMinutes ?? DEFAULTS.silentGiveUpMinutes))),
      replyRounds: Math.max(1, Math.min(60, Number(raw.replyRounds ?? DEFAULTS.replyRounds))),
      actRounds: Math.max(1, Math.min(60, Number(raw.actRounds ?? DEFAULTS.actRounds))),
      v3MinValue: Math.max(0, Math.min(10, Number(raw.v3MinValue ?? DEFAULTS.v3MinValue))),
      v3MaxEvents: Math.max(1, Math.min(30, Number(raw.v3MaxEvents ?? DEFAULTS.v3MaxEvents))),
      thinkGapMinMinutes: clamp(Number(raw.thinkGapMinMinutes ?? DEFAULTS.thinkGapMinMinutes), 0.3, 60),
      thinkGapMaxMinutes: clamp(Number(raw.thinkGapMaxMinutes ?? DEFAULTS.thinkGapMaxMinutes), 0.6, 120),
      thinkIdleSeconds: clamp(Number(raw.thinkIdleSeconds ?? DEFAULTS.thinkIdleSeconds), 0, 600),
      thinkSettleSeconds: clamp(Number(raw.thinkSettleSeconds ?? DEFAULTS.thinkSettleSeconds), 0, 600),
      thinkChance: clamp(Number(raw.thinkChance ?? DEFAULTS.thinkChance), 0, 1),
      planDoneMemoryValue: clamp(Number(raw.planDoneMemoryValue ?? DEFAULTS.planDoneMemoryValue), 0, 10),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveTuning(dataDir: string, t: Partial<Tuning>): Tuning {
  const cur = loadTuning(dataDir);
  const next: Tuning = {
    replyTemperature: clamp(Number(t.replyTemperature ?? cur.replyTemperature), 0, 1.5),
    extractTemperature: clamp(Number(t.extractTemperature ?? cur.extractTemperature), 0, 1),
    groupSpeakThreshold: clamp(Number(t.groupSpeakThreshold ?? cur.groupSpeakThreshold), 0, 1),
    silentCheckMinutes: Math.max(1, Math.min(120, Number(t.silentCheckMinutes ?? cur.silentCheckMinutes))),
    silentGiveUpMinutes: Math.max(5, Math.min(1440, Number(t.silentGiveUpMinutes ?? cur.silentGiveUpMinutes))),
    replyRounds: Math.max(1, Math.min(60, Number(t.replyRounds ?? cur.replyRounds))),
    actRounds: Math.max(1, Math.min(60, Number(t.actRounds ?? cur.actRounds))),
    v3MinValue: Math.max(0, Math.min(10, Number(t.v3MinValue ?? cur.v3MinValue))),
    v3MaxEvents: Math.max(1, Math.min(30, Number(t.v3MaxEvents ?? cur.v3MaxEvents))),
    thinkGapMinMinutes: clamp(Number(t.thinkGapMinMinutes ?? cur.thinkGapMinMinutes), 0.3, 60),
    thinkGapMaxMinutes: clamp(Number(t.thinkGapMaxMinutes ?? cur.thinkGapMaxMinutes), 0.6, 120),
    thinkIdleSeconds: clamp(Number(t.thinkIdleSeconds ?? cur.thinkIdleSeconds), 0, 600),
    thinkSettleSeconds: clamp(Number(t.thinkSettleSeconds ?? cur.thinkSettleSeconds), 0, 600),
    thinkChance: clamp(Number(t.thinkChance ?? cur.thinkChance), 0, 1),
    planDoneMemoryValue: clamp(Number(t.planDoneMemoryValue ?? cur.planDoneMemoryValue), 0, 10),
  };
  const f = fileOf(dataDir);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
