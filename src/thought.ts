import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 「最近想过什么」。
 *
 * 防重复用：它今天连着四次想起「财富自由」，那是没有新东西可想的信号，
 * 不是深情。想起来过的东西要能认出来，然后**换个方向去获取新的**。
 */
export interface ThoughtRecord {
  anchor: string;
  at: number;
  goal: string;
  channel: string;
}

function fileOf(dataDir: string): string {
  return join(dataDir, "thoughts.json");
}

export function loadThoughts(dataDir: string): ThoughtRecord[] {
  const path = fileOf(dataDir);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as ThoughtRecord[];
    return Array.isArray(raw) ? raw.slice(-40) : [];
  } catch {
    return [];
  }
}

export function rememberThought(dataDir: string, record: ThoughtRecord): void {
  const path = fileOf(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const all = [...loadThoughts(dataDir), record].slice(-40);
  writeFileSync(path, JSON.stringify(all, null, 1), "utf8");
}

/** 最近 12 小时想过的锚点名字 */
export function recentAnchors(dataDir: string, hours = 12): string[] {
  const since = Date.now() - hours * 3_600_000;
  return loadThoughts(dataDir)
    .filter((r) => r.at >= since)
    .map((r) => r.anchor);
}

/** 这个锚点最近想过几次（用来判断“是不是又在原地打转”） */
export function anchorRepeats(dataDir: string, name: string, hours = 12): number {
  const since = Date.now() - hours * 3_600_000;
  return loadThoughts(dataDir).filter((r) => r.at >= since && r.anchor === name).length;
}
