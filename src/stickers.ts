import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 表情包：搜狗图片搜 → 本地缓存 → 发出去。
 *
 * 为什么必须本地缓存：
 *  - 搜狗返回的是第三方图（duoziwang 之类），直发外链会被防盗链挡、或者图早就删了；
 *  - QQ 发图最好用 base64（NapCat 同机最稳），那就必须有本地文件；
 *  - 缓存下来还能按 hash 去重、记「用过几次」，避免一直发同一张。
 *
 * 内容安全：搜狗每条都带 pic_porn_score / pic_sexy_score / pic_vulgar_score，
 * 超过阈值的直接丢掉——比事后人工抽查靠谱。
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

export interface StickerRec {
  hash: string;
  file: string;
  query: string;
  title: string;
  source: string;
  addedAt: number;
  usedCount: number;
  lastUsedAt: number;
  width: number;
  height: number;
}

interface Index {
  items: StickerRec[];
}

/** 每小时最多发几张（全局） */
export const MAX_PER_HOUR = 6;
/** 同一张图至少隔多久才能再发 */
export const SAME_STICKER_COOLDOWN_MS = 30 * 60_000;
/** 超过多久没用的清掉 */
export const PRUNE_AFTER_MS = 45 * 86_400_000;

export function stickerDir(dataDir: string): string {
  const dir = join(dataDir, "stickers");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function indexPath(dataDir: string): string {
  return join(stickerDir(dataDir), "index.json");
}

export function loadIndex(dataDir: string): Index {
  try {
    const raw = JSON.parse(readFileSync(indexPath(dataDir), "utf8")) as Index;
    if (Array.isArray(raw.items)) return raw;
  } catch {
    // 没有就用空的
  }
  return { items: [] };
}

function saveIndex(dataDir: string, idx: Index): void {
  writeFileSync(indexPath(dataDir), JSON.stringify(idx, null, 1), "utf8");
}

function magicKind(buf: Buffer): { ext: string; ok: boolean } {
  if (buf.length < 12) return { ext: "", ok: false };
  if (buf.subarray(0, 3).toString("hex") === "ffd8ff") return { ext: "jpg", ok: true };
  if (buf.subarray(0, 4).toString("hex") === "89504e47") return { ext: "png", ok: true };
  if (buf.subarray(0, 4).toString("hex") === "47494638") return { ext: "gif", ok: true };
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return { ext: "webp", ok: true };
  }
  return { ext: "", ok: false };
}

interface SogouItem {
  thumbUrl?: string;
  picUrl?: string;
  title?: string;
  width?: number;
  height?: number;
  pic_porn_score?: number;
  pic_sexy_score?: number;
  pic_vulgar_score?: number;
}

/** 从搜狗图片搜索结果页的 __INITIAL_STATE__ 里抠出图片列表 */
export function parseSogouHtml(html: string): SogouItem[] {
  const start = html.indexOf("__INITIAL_STATE__");
  if (start < 0) return [];
  const brace = html.indexOf("{", start);
  if (brace < 0) return [];
  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return [];
  try {
    const state = JSON.parse(html.slice(brace, end)) as {
      searchList?: { searchList?: SogouItem[] };
    };
    return state.searchList?.searchList ?? [];
  } catch {
    return [];
  }
}

/** 搜狗搜表情包（不带关键词后缀，调用方自己加「表情包」也行） */
export async function searchSogou(query: string, limit = 10): Promise<SogouItem[]> {
  const url = `https://pic.sogou.com/pics?query=${encodeURIComponent(query)}&mode=1`;
  const res = await fetch(url, {
    headers: { "user-agent": UA, referer: "https://pic.sogou.com/" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`搜狗返回 ${res.status}`);
  const html = await res.text();
  return parseSogouHtml(html)
    .filter((it) => {
      const porn = Number(it.pic_porn_score ?? 0);
      const sexy = Number(it.pic_sexy_score ?? 0);
      const vulgar = Number(it.pic_vulgar_score ?? 0);
      return porn < 0.05 && sexy < 0.2 && vulgar < 0.3;
    })
    .slice(0, limit);
}

/** 下载一张图并入库；失败返回 null（不抛，让调用方继续试下一张） */
export async function downloadSticker(
  dataDir: string,
  item: SogouItem,
  query: string,
): Promise<{ rec: StickerRec; isNew: boolean } | null> {
  const src = item.thumbUrl || item.picUrl;
  if (!src) return null;
  try {
    const res = await fetch(src, {
      headers: { "user-agent": UA, referer: "https://pic.sogou.com/" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2048 || buf.length > 3 * 1024 * 1024) return null;
    const kind = magicKind(buf);
    if (!kind.ok) return null;
    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const file = join(stickerDir(dataDir), `${hash}.${kind.ext}`);
    if (!existsSync(file)) writeFileSync(file, buf);

    const idx = loadIndex(dataDir);
    const existing = idx.items.find((x) => x.hash === hash);
    if (existing) return { rec: existing, isNew: false };
    const rec: StickerRec = {
      hash,
      file,
      query,
      title: String(item.title ?? "").slice(0, 60),
      source: src.slice(0, 200),
      addedAt: Date.now(),
      usedCount: 0,
      lastUsedAt: 0,
      width: Number(item.width ?? 0),
      height: Number(item.height ?? 0),
    };
    idx.items.push(rec);
    saveIndex(dataDir, idx);
    return { rec, isNew: true };
  } catch {
    return null;
  }
}

/** 直接存一份图片字节（GIF 导入、别人发的图都走这里） */
export function addStickerBytes(
  dataDir: string,
  buf: Buffer,
  meta: { query: string; title?: string; source?: string },
): { rec: StickerRec; isNew: boolean } | null {
  if (buf.length < 2048 || buf.length > 4 * 1024 * 1024) return null;
  const kind = magicKind(buf);
  if (!kind.ok) return null;
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const idx = loadIndex(dataDir);
  const existing = idx.items.find((x) => x.hash === hash);
  if (existing) return { rec: existing, isNew: false };
  const file = join(stickerDir(dataDir), `${hash}.${kind.ext}`);
  if (!existsSync(file)) writeFileSync(file, buf);
  const rec: StickerRec = {
    hash,
    file,
    query: meta.query,
    title: String(meta.title ?? "").slice(0, 60),
    source: String(meta.source ?? "").slice(0, 200),
    addedAt: Date.now(),
    usedCount: 0,
    lastUsedAt: 0,
    width: 0,
    height: 0,
  };
  idx.items.push(rec);
  saveIndex(dataDir, idx);
  return { rec, isNew: true };
}

/**
 * 从聊天消息里把别人发的图收进表情包库。
 *
 * 只收：http(s) 的 url、2KB–4MB、真图。一条消息最多收 2 张，
 * 免得有人一次甩十张图就把库塞满。失败静默——收图不该影响正常聊天。
 */
export async function saveFromMessage(dataDir: string, text: string, maxPerMessage = 2): Promise<number> {
  const urls: string[] = [];
  for (const m of text.matchAll(/\[CQ:image,[^\]]*?url=([^,\]]+)/g)) {
    try {
      const u = decodeURIComponent(m[1]);
      if (/^https?:\/\//i.test(u)) urls.push(u);
    } catch {
      // url 编码坏了就跳过
    }
  }
  if (urls.length === 0) return 0;
  let saved = 0;
  for (const url of urls.slice(0, maxPerMessage)) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12_000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const got = addStickerBytes(dataDir, buf, { query: "别人发的", title: "群里收的", source: url });
      if (got?.isNew) saved += 1;
    } catch {
      // 单张失败不影响别的
    }
  }
  return saved;
}

function recentCount(dataDir: string, withinMs: number): number {
  const now = Date.now();
  return loadIndex(dataDir).items.filter((x) => x.lastUsedAt > 0 && now - x.lastUsedAt < withinMs).length;
}

/** 从库里挑一张：优先没发过的，其次最久没发的 */
export function pickFromLibrary(dataDir: string, query: string): StickerRec | null {
  const items = loadIndex(dataDir).items.filter((x) => existsSync(x.file));
  const scoped = query
    ? items.filter((x) => x.query.includes(query) || x.title.includes(query))
    : items;
  const pool = scoped.length > 0 ? scoped : items;
  const now = Date.now();
  const usable = pool
    .filter((x) => now - x.lastUsedAt > SAME_STICKER_COOLDOWN_MS)
    .sort((a, b) => a.usedCount - b.usedCount || a.lastUsedAt - b.lastUsedAt);
  return usable[0] ?? null;
}

export function markUsed(rec: StickerRec): void {
  const idx = loadIndex(join(rec.file, "..", ".."));
  const hit = idx.items.find((x) => x.hash === rec.hash);
  if (!hit) return;
  hit.usedCount += 1;
  hit.lastUsedAt = Date.now();
  saveIndex(join(rec.file, "..", ".."), idx);
}

/** 记一次使用（按 hash，不依赖 rec 的来源路径） */
export function markUsedByHash(dataDir: string, hash: string): void {
  const idx = loadIndex(dataDir);
  const hit = idx.items.find((x) => x.hash === hash);
  if (!hit) return;
  hit.usedCount += 1;
  hit.lastUsedAt = Date.now();
  saveIndex(dataDir, idx);
}

export interface StickerResult {
  ok: boolean;
  text: string;
  file?: string;
}

/**
 * 「发一张表情包」的完整流程。
 * 库里没有合适的就去搜狗搜（搜到的顺便入库，库自己会长大）。
 */
export async function getSticker(
  dataDir: string,
  opts: { query?: string; allowSearch?: boolean } = {},
): Promise<StickerResult> {
  if (recentCount(dataDir, 3_600_000) >= MAX_PER_HOUR) {
    return { ok: false, text: `这个小时已经发了 ${MAX_PER_HOUR} 张了，先歇歇——发太多会变成刷屏。` };
  }
  const query = String(opts.query ?? "").trim();
  let rec = pickFromLibrary(dataDir, query);
  if (!rec && opts.allowSearch !== false) {
    const q = query || "表情包";
    const items = await searchSogou(q.includes("表情") ? q : `${q}表情包`, 8);
    for (const item of items) {
      const got = await downloadSticker(dataDir, item, query || "表情包");
      if (got) {
        rec = got.rec;
        break;
      }
    }
  }
  if (!rec) {
    return { ok: false, text: `没找到「${query || "表情包"}」合适的图（搜到的要么不相关、要么被安全分拦了）。可以换个说法再试。` };
  }
  markUsedByHash(dataDir, rec.hash);
  return { ok: true, text: `发了张表情包（${rec.width}x${rec.height}，用过 ${rec.usedCount + 1} 次）`, file: rec.file };
}

/** 清掉很久没用的，别让目录无限长 */
export function pruneStickers(dataDir: string): number {
  const idx = loadIndex(dataDir);
  const now = Date.now();
  const keep: StickerRec[] = [];
  let removed = 0;
  for (const rec of idx.items) {
    if (rec.usedCount === 0 && now - rec.addedAt > 7 * 86_400_000) {
      // 收进来一周都没用过，多半是不合适
      try {
        unlinkSync(rec.file);
      } catch {
        /* 已经不在了 */
      }
      removed++;
      continue;
    }
    if (now - Math.max(rec.lastUsedAt, rec.addedAt) > PRUNE_AFTER_MS) {
      try {
        unlinkSync(rec.file);
      } catch {
        /* 已经不在了 */
      }
      removed++;
      continue;
    }
    if (existsSync(rec.file)) keep.push(rec);
  }
  if (removed > 0) {
    idx.items = keep;
    saveIndex(dataDir, idx);
  }
  return removed;
}

export function stickerStats(dataDir: string): { count: number; used: number; bytes: number } {
  const idx = loadIndex(dataDir);
  let bytes = 0;
  for (const rec of idx.items) {
    try {
      bytes += statSync(rec.file).size;
    } catch {
      /* 文件没了就不算 */
    }
  }
  return { count: idx.items.length, used: idx.items.filter((x) => x.usedCount > 0).length, bytes };
}

/** 预下载用的默认关键词：覆盖聊天里最常用的几种情绪 */
export const DEFAULT_PREFETCH_QUERIES = [
  "猫猫表情包",
  "笑死",
  "无语",
  "委屈",
  "难过",
  "生气",
  "贴贴",
  "晚安",
  "早安",
  "加油",
  "震惊",
  "尴尬",
  "害羞",
  "得意",
  "叹气",
  "摸鱼",
  "吃饭",
  "睡觉",
  "比心",
  "狗头",
  "哈哈哈",
  "抱抱",
  "谢谢",
  "拒绝",
  "点赞",
  "摸头",
];

/** 库里最多留多少张（超了从最久没用的开始清） */
export const MAX_LIBRARY = 240;

export interface PrefetchStats {
  queries: number;
  added: number;
  skipped: number;
  bytes: number;
}

/**
 * 预下载：挨个关键词搜一遍，每个词存几张。
 *
 * 为什么要有这个：临时搜要等 5-10 秒，聊到一半才去找图会卡；
 * 提前把常见情绪存下来，发的时候基本是「秒发」。
 */
export async function prefetchStickers(
  dataDir: string,
  opts: { queries?: string[]; perQuery?: number; maxTotal?: number } = {},
): Promise<PrefetchStats> {
  const queries = (opts.queries ?? DEFAULT_PREFETCH_QUERIES).map((q) => q.trim()).filter((q) => q.length > 0);
  const perQuery = Math.max(1, Math.min(8, opts.perQuery ?? 3));
  const maxTotal = Math.max(1, Math.min(MAX_LIBRARY, opts.maxTotal ?? 60));

  const before = loadIndex(dataDir).items.length;
  const stats: PrefetchStats = { queries: 0, added: 0, skipped: 0, bytes: 0 };

  for (const query of queries) {
    if (loadIndex(dataDir).items.length - before >= maxTotal) break;
    stats.queries += 1;
    let items: Awaited<ReturnType<typeof searchSogou>> = [];
    try {
      items = await searchSogou(query.includes("表情") ? query : `${query}表情包`, 8);
    } catch {
      stats.skipped += 1;
      continue;
    }
    let addedThisQuery = 0;
    for (const item of items) {
      if (addedThisQuery >= perQuery) break;
      const got = await downloadSticker(dataDir, item, query);
      if (!got) {
        stats.skipped += 1;
        continue;
      }
      if (!got.isNew) continue;
      const rec = got.rec;
      addedThisQuery += 1;
      stats.added += 1;
      try {
        stats.bytes += statSync(rec.file).size;
      } catch {
        /* ignore */
      }
    }
  }

  // 超过上限就从最久没用的开始删
  const idx = loadIndex(dataDir);
  if (idx.items.length > MAX_LIBRARY) {
    const keep = [...idx.items].sort((a, b) => {
      const ka = a.usedCount === 0 ? 0 : 1;
      const kb = b.usedCount === 0 ? 0 : 1;
      return ka - kb || a.lastUsedAt - b.lastUsedAt;
    });
    const drop = keep.slice(0, keep.length - MAX_LIBRARY);
    for (const rec of drop) {
      try {
        unlinkSync(rec.file);
      } catch {
        /* 已经不在了 */
      }
    }
    idx.items = keep.slice(drop.length);
    saveIndex(dataDir, idx);
  }

  return stats;
}

