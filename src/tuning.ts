import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 两个概率，别混。
 *
 * followUpChance —— 整体：回完一句之后，有多大概率回头看一遍。这个她可以调，白天调、睡觉时调都行。
 * silentChance   —— 这一条：刚说完的那些话，还值不值得再看一遍。
 *                   她读完觉得没必要，就把这条置 0，这一轮不再回头看了。
 *                   下一条消息重新按整体概率算。
 *
 * 为什么分两层：整体是「我这个人的习惯」，这一条是「这几句话已经说完了」。
 * 混成一个数，她要么永远啰嗦、要么永远干脆。
 */
export interface Tuning {
  /** 整体：回完一句之后回头看一遍的概率（0-1） */
  followUpChance: number;
  /** 整体：最多回头看几遍 */
  followUpRounds: number;
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
  /** 一次活动最多调几轮工具 */
  maxToolRounds: number;
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
  followUpChance: 0.6,
  followUpRounds: 3,
  replyTemperature: 0.9,
  extractTemperature: 0.3,
  groupSpeakThreshold: 0.6,
  silentCheckMinutes: 3,
  silentGiveUpMinutes: 60,
  maxToolRounds: 0,
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
      followUpChance: clamp(Number(raw.followUpChance ?? DEFAULTS.followUpChance), 0, 1),
      followUpRounds: Math.max(1, Math.min(5, Number(raw.followUpRounds ?? DEFAULTS.followUpRounds))),
      replyTemperature: clamp(Number(raw.replyTemperature ?? DEFAULTS.replyTemperature), 0, 1.5),
      extractTemperature: clamp(Number(raw.extractTemperature ?? DEFAULTS.extractTemperature), 0, 1),
      groupSpeakThreshold: clamp(Number(raw.groupSpeakThreshold ?? DEFAULTS.groupSpeakThreshold), 0, 1),
      silentCheckMinutes: Math.max(1, Math.min(120, Number(raw.silentCheckMinutes ?? DEFAULTS.silentCheckMinutes))),
      silentGiveUpMinutes: Math.max(5, Math.min(1440, Number(raw.silentGiveUpMinutes ?? DEFAULTS.silentGiveUpMinutes))),
      maxToolRounds: Math.max(0, Math.min(200, Number(raw.maxToolRounds ?? DEFAULTS.maxToolRounds))),
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
    followUpChance: clamp(Number(t.followUpChance ?? cur.followUpChance), 0, 1),
    followUpRounds: Math.max(1, Math.min(5, Number(t.followUpRounds ?? cur.followUpRounds))),
    replyTemperature: clamp(Number(t.replyTemperature ?? cur.replyTemperature), 0, 1.5),
    extractTemperature: clamp(Number(t.extractTemperature ?? cur.extractTemperature), 0, 1),
    groupSpeakThreshold: clamp(Number(t.groupSpeakThreshold ?? cur.groupSpeakThreshold), 0, 1),
    silentCheckMinutes: Math.max(1, Math.min(120, Number(t.silentCheckMinutes ?? cur.silentCheckMinutes))),
    silentGiveUpMinutes: Math.max(5, Math.min(1440, Number(t.silentGiveUpMinutes ?? cur.silentGiveUpMinutes))),
    maxToolRounds: Math.max(0, Math.min(200, Number(t.maxToolRounds ?? cur.maxToolRounds))),
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

/**
 * 这一轮还想不想再看。
 * 她说「够了」，这条就归零；下一条消息重新算。
 */
export function makeTurnChance(globalChance: number): { value: number; stop: () => void } {
  let v = globalChance;
  return {
    get value() {
      return v;
    },
    stop() {
      v = 0;
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
