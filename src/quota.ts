import type { DatabaseSync } from "node:sqlite";
import { dayKey } from "./util.ts";

/**
 * 每日额度。
 *
 * 存在的理由不是省钱，是**制造稀缺**：
 * 一个能无限刷视频的模型会把额度当空气，什么都看、什么都记，最后什么也没记住。
 * 每天只给 20 个，它就不得不判断「这个值不值得花掉一次」——这个判断本身，
 * 才是它长出自己的品味的地方。
 */
export type QuotaKind = "video" | "write";

export function quotaUsed(db: DatabaseSync, kind: QuotaKind, day = dayKey(Date.now())): number {
  const row = db.prepare("SELECT used FROM daily_quota WHERE day = ? AND kind = ?").get(day, kind) as
    | { used: number }
    | undefined;
  return Number(row?.used ?? 0);
}

export function quotaRemaining(db: DatabaseSync, kind: QuotaKind, limit: number, day = dayKey(Date.now())): number {
  return Math.max(0, limit - quotaUsed(db, kind, day));
}

/** 花掉一次；返回花掉之后还剩几次 */
export function quotaSpend(db: DatabaseSync, kind: QuotaKind, limit: number, day = dayKey(Date.now())): number {
  db.prepare(
    "INSERT INTO daily_quota (day, kind, used) VALUES (?, ?, 1) ON CONFLICT(day, kind) DO UPDATE SET used = used + 1",
  ).run(day, kind);
  return quotaRemaining(db, kind, limit, day);
}

export function quotaSnapshot(
  db: DatabaseSync,
  limits: { video: number; write: number },
  day = dayKey(Date.now()),
): { video: { used: number; limit: number }; write: { used: number; limit: number } } {
  return {
    video: { used: quotaUsed(db, "video", day), limit: limits.video },
    write: { used: quotaUsed(db, "write", day), limit: limits.write },
  };
}
