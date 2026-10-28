import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 待办队列：她自己记下的「想做但先不做」的事。
 *
 * 为什么要它：走神以前「决定去做」就立刻动手，一次 188 次、每次一次全量模型请求。
 * 现在改成「只记账」——她把要做的事写进这里，攒够了批处理一次性做掉。
 *
 * 三个 kind：
 *   light —— 查一下 / 记一条 / 改规矩。可以攒批处理。
 *   deep  —— 「想清楚我为什么总搞错人名」这类，需要多轮追问，每批最多 3 条。
 *   heavy —— 要看 B 站 / 读屏 / 读长文件。**不进批处理**（正文会污染上下文），
 *            由阅读员单独跑。
 */

export type QueueKind = "light" | "deep" | "heavy";
export type QueueStatus = "pending" | "running" | "done" | "failed" | "expired";

export interface QueueItem {
  id: string;
  /** 什么时候想做的（ISO，本地时区） */
  at: string;
  kind: QueueKind;
  /** 为什么想做 */
  why: string;
  /** 要做什么 */
  what: string;
  /** 做完什么样算完成（没有这条，批处理时就会敷衍） */
  done: string;
  status: QueueStatus;
  tries: number;
  /** 同一件事被记过几次（>1 = 她一直在同一个坑里打转，这是信号） */
  merges?: number;
  /** 最近一次又想起它 */
  lastAt?: string;
  /** 结果（一句话） */
  result: string;
}

/**
 * 判断两件事是不是同一个主题。
 *
 * 不用 Jaccard：她的手写句子又长又少重复用词，实测最高只有 0.11；
 * 但「称呼」「追问」「四遍」这种**具体词块**能对上。
 * 规则：**共享 ≥2 个非通用的二字词块 → 同一个主题**。
 * （拿今天真实的 12 条验过：合并 10 对，都是同一件事的不同说法。）
 */
const STOP_CHARS = new Set(
  "的了是我他她你这那一不把在个上又就还要想做说和与而且但没也都很有会能可以自己对被从到为所以因为如果这样那样什么怎么多少".split(""),
);
const GENERIC = new Set([
  "找出", "出来", "以后", "现在", "这条", "那件", "一件", "下次", "先问", "到底",
  "已经", "正在", "这件", "那个", "这个", "事情", "东西", "问题", "规矩", "记忆",
  "说话", "想法", "办法", "方法", "内容", "地方", "时候", "一套", "一条", "一遍",
  "一次", "第一", "第二", "第三", "第四", "句里", "句话",
]);

function topicTerms(text: string): Set<string> {
  const clean = String(text).replace(/[\s\p{P}\p{S}]+/gu, "");
  const out = new Set<string>();
  for (let i = 0; i < clean.length - 1; i += 1) {
    const g = clean.slice(i, i + 2);
    if ([...g].some((c) => STOP_CHARS.has(c))) continue;
    if (GENERIC.has(g)) continue;
    out.add(g);
  }
  return out;
}

/** 共享几个词块（只看 what；why 常常是同一句话的复述） */
function sharedTerms(a: string, b: string): number {
  const A = topicTerms(a);
  const B = topicTerms(b);
  let n = 0;
  for (const g of A) if (B.has(g)) n += 1;
  return n;
}

const KINDS: QueueKind[] = ["light", "deep", "heavy"];

/**
 * 队列里的时间是**本地时间字符串**（"2026-10-28 13:05"）。
 *
 * 别用 toISOString：它是 UTC，而读回来时 `Date.parse` 按本地解析——
 * 东八区就差整整 8 小时，「等了几分钟」会直接变成「等了 480 分钟」，
 * 于是一建队就满足「最老的等了 30 分钟」，批处理立刻乱跑。
 */
export function stampLocal(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 把队列里的时间字符串解析成本地时间戳（解析不了返回 NaN） */
export function parseStamp(s: string): number {
  return Date.parse(String(s).replace(" ", "T"));
}

export function queuePath(dataDir: string): string {
  return join(dataDir, "todo-queue.json");
}

export function loadQueue(dataDir: string): QueueItem[] {
  try {
    const f = queuePath(dataDir);
    if (!existsSync(f)) return [];
    const raw = JSON.parse(readFileSync(f, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is QueueItem => Boolean(x) && typeof x === "object" && typeof (x as QueueItem).id === "string");
  } catch {
    return [];
  }
}

/** 原子写：先写 .tmp 再 rename，免得批处理中途崩了把队列写坏 */
export function saveQueue(dataDir: string, items: QueueItem[]): void {
  const f = queuePath(dataDir);
  mkdirSync(dataDir, { recursive: true });
  const tmp = `${f}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  renameSync(tmp, f);
}

function nextId(items: QueueItem[], now = new Date()): string {
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const used = new Set(items.map((i) => i.id));
  for (let n = items.length + 1; n < items.length + 200; n += 1) {
    const id = `q${day}-${n}`;
    if (!used.has(id)) return id;
  }
  return `q${day}-${Date.now()}`;
}

export interface AddInput {
  kind?: string;
  why: string;
  what: string;
  done?: string;
}

export function addItem(
  dataDir: string,
  input: AddInput,
  now = new Date(),
): { ok: boolean; item?: QueueItem; reason?: string; total?: number; merged?: boolean } {
  const what = String(input.what ?? "").trim();
  if (what.length < 2) return { ok: false, reason: "没写清要做什么" };
  const kindRaw = String(input.kind ?? "light").trim().toLowerCase() as QueueKind;
  const kind: QueueKind = KINDS.includes(kindRaw) ? kindRaw : "light";
  const why = String(input.why ?? "").trim();

  const items = loadQueue(dataDir);

  // ① 完全一样：what 前 20 字相同 —— 直接拒
  const dup = items.find((i) => i.status === "pending" && i.what.slice(0, 20) === what.slice(0, 20));
  if (dup) return { ok: false, reason: `这件事已经在队列里了（${dup.id}）`, item: dup, total: items.length };

  // ② 同一个主题的另一种说法 —— 并进已有的那条，并把「又想了第几次」记下来。
  //    这比另开一条有用：批处理时会看到「同一件事想了 8 次」，那是该一次做透的信号。
  const same = items
    .filter((i) => i.status === "pending" && i.kind === kind)
    .map((i) => ({ i, n: sharedTerms(i.what, what) + sharedTerms(i.what, why) * 0.5 }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)[0];
  if (same) {
    const hit = same.i;
    hit.merges = (hit.merges ?? 1) + 1;
    hit.lastAt = stampLocal(now);
    if (why.length > 0 && !hit.why.includes(why.slice(0, 12))) {
      hit.why = `${hit.why}${hit.why.length > 0 ? " ／ " : ""}${why}`.slice(0, 400);
    }
    // 原来的 at 不动：不然 90 分钟的等待会被无限续期
    saveQueue(dataDir, items);
    return {
      ok: false,
      merged: true,
      item: hit,
      reason: `这就是 ${hit.id} 那件事（已经想了 ${hit.merges} 次），并进去不新开`,
      total: items.length,
    };
  }

  const item: QueueItem = {
    id: nextId(items, now),
    at: stampLocal(now),
    kind,
    why,
    what,
    done: String(input.done ?? "").trim(),
    status: "pending",
    tries: 0,
    merges: 1,
    result: "",
  };
  items.push(item);
  saveQueue(dataDir, items);
  return { ok: true, item, total: items.length };
}

export function markItem(
  dataDir: string,
  id: string,
  status: QueueStatus,
  result = "",
): boolean {
  const items = loadQueue(dataDir);
  const hit = items.find((i) => i.id === id);
  if (!hit) return false;
  hit.status = status;
  if (result.length > 0) hit.result = result.slice(0, 300);
  if (status === "failed") hit.tries += 1;
  saveQueue(dataDir, items);
  return true;
}

/** 超过 N 小时还没做的丢掉（不然越攒越多、越来越慢） */
export function expireOld(dataDir: string, hours = 24, now = Date.now()): number {
  const items = loadQueue(dataDir);
  const cutoff = now - hours * 3_600_000;
  let n = 0;
  for (const i of items) {
    if (i.status !== "pending") continue;
    const at = parseStamp(i.at);
    if (Number.isFinite(at) && at < cutoff) {
      i.status = "expired";
      i.result = i.result || "等太久，没做";
      n += 1;
    }
  }
  if (n > 0) saveQueue(dataDir, items);
  return n;
}

export function pendingOf(items: QueueItem[], kinds: QueueKind[]): QueueItem[] {
  return items
    .filter((i) => i.status === "pending" && kinds.includes(i.kind))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function queueStats(dataDir: string): {
  pending: number;
  light: number;
  deep: number;
  heavy: number;
  oldestMinutes: number;
  done: number;
  failed: number;
  expired: number;
} {
  const items = loadQueue(dataDir);
  const pend = items.filter((i) => i.status === "pending");
  const oldest = pend.reduce((min, i) => {
    const at = parseStamp(i.at);
    return Number.isFinite(at) ? Math.min(min, at) : min;
  }, Number.POSITIVE_INFINITY);
  return {
    pending: pend.length,
    light: pend.filter((i) => i.kind === "light").length,
    deep: pend.filter((i) => i.kind === "deep").length,
    heavy: pend.filter((i) => i.kind === "heavy").length,
    oldestMinutes: Number.isFinite(oldest) ? Math.round((Date.now() - oldest) / 60_000) : 0,
    done: items.filter((i) => i.status === "done").length,
    failed: items.filter((i) => i.status === "failed").length,
    expired: items.filter((i) => i.status === "expired").length,
  };
}

/** 队列文本（给工具和批处理看） */
export function describeItem(i: QueueItem, n?: number): string {
  const head = n ? `${n}. ` : "";
  const times = (i.merges ?? 1) > 1 ? `（同一件事你想了 ${i.merges} 次——这次别再绕）` : "";
  return [
    `${head}[${i.id}]（${i.kind}）${i.what}${times}`,
    i.why.length > 0 ? `    为什么：${i.why}` : "",
    i.done.length > 0 ? `    做完算成：${i.done}` : "",
    i.tries > 0 ? `    （试过 ${i.tries} 次没成）` : "",
  ]
    .filter((s) => s.length > 0)
    .join("\n");
}
