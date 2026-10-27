import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 同一张图不重复描述。
 *
 * 问题：群友爱发表情包，同一张图一晚能发十几次。
 * 每次都描述一遍 → ① 每次花 3 秒 ② 同样的文字进好几轮对话
 * → 抽取时变成好几条「他发了张图：一只猫」，把检索稀释。
 *
 * 做法：按图片内容哈希记住「什么时候描述过」。
 *   10 分钟内又见到 → 只留一句「（又是刚才那张图）」，不再描述、不再占记忆。
 *   超过 10 分钟 → 当新的一次，重新描述（语境可能不同）。
 */
interface Entry {
  desc: string;
  at: number;
}

const WINDOW_MS = 10 * 60_000;

function cachePath(dataDir: string): string {
  return join(dataDir, "vision-cache.json");
}

export function loadVisionCache(dataDir: string): Record<string, Entry> {
  try {
    const f = cachePath(dataDir);
    if (!existsSync(f)) return {};
    return JSON.parse(readFileSync(f, "utf8")) as Record<string, Entry>;
  } catch {
    return {};
  }
}

export function saveVisionCache(dataDir: string, cache: Record<string, Entry>): void {
  try {
    // 只留最近 200 条，别无限长
    const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 200);
    writeFileSync(cachePath(dataDir), JSON.stringify(Object.fromEntries(entries)), "utf8");
  } catch {
    // 缓存写不进去不影响看图
  }
}

export function remembered(dataDir: string, hash: string): string | null {
  const cache = loadVisionCache(dataDir);
  const hit = cache[hash];
  if (!hit) return null;
  if (Date.now() - hit.at > WINDOW_MS) return null;
  return hit.desc;
}

export function remember(dataDir: string, hash: string, desc: string): void {
  const cache = loadVisionCache(dataDir);
  cache[hash] = { desc, at: Date.now() };
  saveVisionCache(dataDir, cache);
}
