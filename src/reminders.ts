import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 提醒的节流。
 *
 * 「还有 N 轮没整理」这句话有用，但念太勤就变噪音。
 * 两小时最多提一次——够她记起来，又不至于一直叨叨。
 */
interface Reminders {
  lastTidyNudge?: number;
}

function fileOf(dataDir: string): string {
  return join(dataDir, "reminders.json");
}

export function canNudge(dataDir: string, key: "lastTidyNudge", gapMs = 2 * 3600_000): boolean {
  try {
    const f = fileOf(dataDir);
    if (!existsSync(f)) return true;
    const r = JSON.parse(readFileSync(f, "utf8")) as Reminders;
    const last = Number(r[key] ?? 0);
    return Date.now() - last >= gapMs;
  } catch {
    return true;
  }
}

export function markNudged(dataDir: string, key: "lastTidyNudge"): void {
  try {
    const f = fileOf(dataDir);
    let r: Reminders = {};
    if (existsSync(f)) {
      try {
        r = JSON.parse(readFileSync(f, "utf8")) as Reminders;
      } catch {
        r = {};
      }
    }
    r[key] = Date.now();
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(r, null, 2), "utf8");
  } catch {
    // 记不上就算了，下次还会提
  }
}
