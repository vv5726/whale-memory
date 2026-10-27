import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 她要知道自己「活着」这件事。
 *
 * 之前重启是无声的：进程没了、又起来了，她不觉得自己断过。
 * 断线也是——只知道发不出去，不知道自己离线了多久。
 *
 * 这里记两个时间点：
 *   bootAt   这次什么时候起来的
 *   downAt   上一次什么时候断的（如果是异常退出，根本没有 downAt，
 *            所以「有 bootAt 没有 downAt」= 上次是崩的）
 */
export interface Uptime {
  bootAt: number;
  downAt?: number;
  /** 上次是不是异常退出（没留下 downAt 就重启了） */
  crashed?: boolean;
  /** 这次断线了多少秒（重连后填） */
  offlineSeconds?: number;
}

function fileOf(dataDir: string): string {
  return join(dataDir, "uptime.json");
}

export function readUptime(dataDir: string): Uptime {
  try {
    const f = fileOf(dataDir);
    if (!existsSync(f)) return { bootAt: 0 };
    return JSON.parse(readFileSync(f, "utf8")) as Uptime;
  } catch {
    return { bootAt: 0 };
  }
}

function write(dataDir: string, u: Uptime): void {
  const f = fileOf(dataDir);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(u, null, 2), "utf8");
}

/** 启动时调用：能判断出上次是不是蹦的 */
export function markBoot(dataDir: string): Uptime {
  const prev = readUptime(dataDir);
  const crashed = prev.bootAt > 0 && !prev.downAt;
  const next: Uptime = {
    bootAt: Date.now(),
    downAt: undefined,
    crashed,
  };
  write(dataDir, next);
  return next;
}

/** 正常退出 / 断线时调用 */
export function markDown(dataDir: string): void {
  const cur = readUptime(dataDir);
  write(dataDir, { ...cur, bootAt: cur.bootAt, downAt: Date.now() });
}

/** 重连上了：算算断了多久 */
export function markReconnect(dataDir: string): Uptime {
  const cur = readUptime(dataDir);
  const offlineSeconds = cur.downAt ? Math.round((Date.now() - cur.downAt) / 1000) : 0;
  const next: Uptime = { ...cur, downAt: undefined, offlineSeconds };
  write(dataDir, next);
  return next;
}

/** 给她看的一句话 */
export function describeUptime(u: Uptime): string {
  const fmt = (ts: number): string => {
    const d = new Date(ts);
    const p = (n: number): string => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const parts: string[] = [];
  if (u.bootAt > 0) parts.push(`我是 ${fmt(u.bootAt)} 醒的`);
  if (u.crashed) parts.push("上次没正常告别就没了（崩的），不是我自己想停");
  if (u.offlineSeconds && u.offlineSeconds > 30) {
    parts.push(`刚才断线约 ${Math.round(u.offlineSeconds / 60)} 分钟`);
  }
  return parts.join("；");
}
