import { randomUUID } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * token 粗估。中文约 1 token ≈ 1.5 字符；英文偏少、中文偏多，
 * 取这个系数只为让预算口径稳定可比，不必精确。
 */
export const CHARS_PER_TOKEN = 1.5;

export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil([...text].length / CHARS_PER_TOKEN));
}

/** 确定性随机源：同一个 seed 永远给出同一串数，保证「同会话内不自我矛盾」可复现。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function softmax(scores: number[], temperature: number): number[] {
  if (scores.length === 0) return [];
  const t = Math.max(0.05, temperature);
  const max = Math.max(...scores);
  const exp = scores.map((s) => Math.exp((s - max) / t));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((e) => e / sum);
}

export function sampleIndex(probs: number[], rnd: () => number): number {
  const r = rnd();
  let acc = 0;
  for (let i = 0; i < probs.length; i += 1) {
    acc += probs[i];
    if (r <= acc) return i;
  }
  return probs.length - 1;
}

export function truncate(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join("")}…`;
}

export function daysBetween(a: number, b: number): number {
  return Math.abs(a - b) / 86_400_000;
}

/** 人类不用日期记事情，用「那阵子」记。 */
export function periodLabel(ts: number, nowTs: number): string {
  const d = new Date(ts);
  const ageDays = daysBetween(ts, nowTs);
  const season = quarterOf(d.getMonth());
  const year = d.getFullYear();
  const base = `${year}年${season}`;
  if (ageDays < 7) return "这几天";
  if (ageDays < 35) return "这个月";
  if (ageDays < 120) return "前几个月";
  if (ageDays < 400) return base;
  return `${base}（${Math.round(ageDays / 365)}年前）`;
}

function quarterOf(month0: number): string {
  const m = month0 + 1;
  if (m <= 3) return "初春";
  if (m <= 6) return "夏天";
  if (m <= 9) return "秋天";
  return "冬天";
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function dayKeyToTs(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`日期格式应为 YYYY-MM-DD：${day}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function splitClauses(text: string): string[] {
  return text
    .split(/[，,、：:]/)
    .map((s) => s.trim())
    .filter((s) => [...s].length >= 2);
}

export function toJson(value: unknown): string {
  return JSON.stringify(value);
}

export function fromJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function padEnd(text: string, width: number): string {
  const chars = [...text];
  if (chars.length >= width) return text;
  return text + " ".repeat(width - chars.length);
}
