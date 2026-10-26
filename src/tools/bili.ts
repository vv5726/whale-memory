import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { quotaRemaining, quotaSpend } from "../quota.ts";
import { createApproval } from "../approvals.ts";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const REF = "https://www.bilibili.com";

/**
 * wbi 签名的置换表。
 *
 * 为什么必须有这个：不带签名请求 player/v2，B站 会**随机丢一个别人的字幕**给你
 * （实测同一个视频连续两次返回不同内容，还都跟视频无关）。
 * 签名之后才是这个视频自己那条。
 */
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52,
];

let wbiCache: { imgKey: string; subKey: string; at: number } | null = null;

export interface BiliOptions {
  /** 登录后的 SESSDATA，拿字幕必须；不填就只能看热门和简介 */
  sessdata?: string;
  /** bili_jct（CSRF token），点赞/评论/弹幕/动态必须 */
  jct?: string;
  /** 每天最多几次写操作 */
  dailyWriteLimit?: number;
  /** 每天能看几个视频（看字幕算一次），这个额度是给它自己管注意力的 */
  videoQuota?: number;
  /** 额度记在库里，重启不丢 */
  db?: DatabaseSync;
  /** 对外发东西之前要不要先问本人 */
  approvalRequired?: boolean;
  /** 把「想做什么」发给他，等他点头 */
  notify?: (text: string) => void;
  timeoutMs?: number;
}

async function api<T>(url: string, opts: BiliOptions): Promise<T> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: REF,
    Accept: "application/json, text/plain, */*",
  };
  if (opts.sessdata && opts.sessdata.length > 0) headers.Cookie = `SESSDATA=${opts.sessdata}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 写操作：表单 POST，必须带 csrf=bili_jct */
async function postForm<T>(url: string, params: Record<string, string | number>, opts: BiliOptions): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: REF,
    "Content-Type": "application/x-www-form-urlencoded",
    Cookie: `SESSDATA=${opts.sessdata ?? ""}; bili_jct=${opts.jct ?? ""}`,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 每日写操作计数（进程内；重启会归零，够用） */
const writeCounter = { day: "", count: 0 };

function writeBudget(limit: number): { ok: boolean; used: number } {
  const today = new Date().toISOString().slice(0, 10);
  if (writeCounter.day !== today) {
    writeCounter.day = today;
    writeCounter.count = 0;
  }
  return { ok: writeCounter.count < limit, used: writeCounter.count };
}

function countWrite(): void {
  writeCounter.count += 1;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}分${String(s).padStart(2, "0")}秒`;
}

function fmtCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return String(n);
}

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

/** wbi 的 img_key / sub_key 会轮换，缓存十分钟 */
async function getWbiKeys(opts: BiliOptions): Promise<{ imgKey: string; subKey: string }> {
  if (wbiCache && Date.now() - wbiCache.at < 10 * 60_000) return wbiCache;
  const nav = await api<{ data?: { wbi_img?: { img_url?: string; sub_url?: string } } }>(
    "https://api.bilibili.com/x/web-interface/nav",
    opts,
  );
  const base = (u: string): string => (u.split("/").pop() ?? "").split(".")[0] ?? "";
  const imgKey = base(nav.data?.wbi_img?.img_url ?? "");
  const subKey = base(nav.data?.wbi_img?.sub_url ?? "");
  if (imgKey.length === 0 || subKey.length === 0) throw new Error("拿不到 wbi 签名用的 key");
  wbiCache = { imgKey, subKey, at: Date.now() };
  return wbiCache;
}

function signWbi(params: Record<string, string | number>, keys: { imgKey: string; subKey: string }): string {
  const raw = keys.imgKey + keys.subKey;
  const mixin = MIXIN_TAB.map((i) => raw[i] ?? "").join("").slice(0, 32);
  const wts = Math.round(Date.now() / 1000);
  const all: Record<string, string | number> = { ...params, wts };
  const query = Object.keys(all)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(all[k]).replace(/[!'()*]/g, ""))}`)
    .join("&");
  return `${query}&w_rid=${md5(query + mixin)}`;
}

interface VideoBrief {
  bvid: string;
  title: string;
  owner?: { name?: string };
  duration?: number;
  stat?: { view?: number; like?: number; danmaku?: number };
  desc?: string;
  pubdate?: number;
}

function formatList(list: VideoBrief[], limit: number): string {
  const picked = list.slice(0, limit);
  return picked
    .map((v, i) => {
      const t = v.title.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').trim();
      const up = v.owner?.name ?? "未知UP";
      const view = fmtCount(v.stat?.view ?? 0);
      const dur = v.duration ? `　${fmtDuration(v.duration)}` : "";
      return `${i + 1}. ${t}　${up}　${view}播放${dur}　(${v.bvid})`;
    })
    .join("\n");
}

/**
 * B 站工具集。
 *
 * 分两层：
 *  - 免登录：热门榜、排行榜、视频详情（标题/简介/UP/播放量）
 *  - 需要 SESSDATA：字幕原文（不登录 B 站一律返回空）
 *
 * 搜索接口有 wbi 签名风控，这里不硬碰，用热门/排行代替「最近流行什么」。
 */
export function registerBiliTools(registry: ToolRegistry, opts: BiliOptions): void {
  const hasLogin = (opts.sessdata ?? "").length > 0;
  const hasJct = (opts.jct ?? "").length > 0;

  const hot: ToolDefinition = {
    name: "bili_hot",
    description:
      "看 B 站当前热门视频排行榜（不需要登录）。想知道「最近网上流行什么」「大家在聊什么」就调这个。",
    parameters: {
      type: "object",
      properties: {
        count: { type: "integer", description: "要几条，默认 8，最多 20" },
      },
    },
    handler: async (args) => {
      const n = Math.min(20, Math.max(1, Number(args.count) || 8));
      try {
        const res = await api<{ code: number; data?: { list?: VideoBrief[] } }>(
          `https://api.bilibili.com/x/web-interface/popular?ps=${n}&pn=1`,
          opts,
        );
        if (res.code !== 0 || !res.data?.list) return { ok: false, text: `B站热门接口返回异常：${res.code}` };
        return { ok: true, text: `B站热门榜前 ${n}：\n${formatList(res.data.list, n)}` };
      } catch (err) {
        return { ok: false, text: `拿热门榜失败：${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
  registry.register(hot);

  const rank: ToolDefinition = {
    name: "bili_rank",
    description: "看 B 站全站排行榜（不需要登录）。热度比热门榜更稳，适合看这一阵子在火什么。",
    parameters: {
      type: "object",
      properties: { count: { type: "integer", description: "要几条，默认 8" } },
    },
    handler: async (args) => {
      const n = Math.min(20, Math.max(1, Number(args.count) || 8));
      try {
        const res = await api<{ code: number; data?: { list?: VideoBrief[] } }>(
          "https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all",
          opts,
        );
        if (res.code !== 0 || !res.data?.list) return { ok: false, text: `B站排行接口返回异常：${res.code}` };
        return { ok: true, text: `B站全站排行前 ${n}：\n${formatList(res.data.list, n)}` };
      } catch (err) {
        return { ok: false, text: `拿排行失败：${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
  registry.register(rank);

  const info: ToolDefinition = {
    name: "bili_info",
    description: "看某个 B 站视频的详情：标题、UP 主、播放量、发布时间、简介全文。需要 BV 号。",
    parameters: {
      type: "object",
      properties: { bvid: { type: "string", description: "形如 BV1d8pU6xEZX" } },
      required: ["bvid"],
    },
    handler: async (args) => {
      const bvid = String(args.bvid ?? "").trim();
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return { ok: false, text: `BV 号格式不对：${bvid}` };
      try {
        const res = await api<{ code: number; data?: VideoBrief & { desc?: string; pubdate?: number } }>(
          `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
          opts,
        );
        if (res.code !== 0 || !res.data) return { ok: false, text: `查不到这个视频（${res.code}）` };
        const d = res.data;
        const date = d.pubdate ? new Date(d.pubdate * 1000).toISOString().slice(0, 10) : "未知";
        return {
          ok: true,
          text: [
            `标题：${d.title}`,
            `UP 主：${d.owner?.name ?? "未知"}　播放：${fmtCount(d.stat?.view ?? 0)}　发布：${date}`,
            `简介：${(d.desc ?? "").trim() || "（没有简介）"}`,
          ].join("\n"),
        };
      } catch (err) {
        return { ok: false, text: `查详情失败：${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
  registry.register(info);

  const subtitle: ToolDefinition = {
    name: "bili_subtitle",
    description: hasLogin
      ? "读某个 B 站视频的字幕原文（理解视频在讲什么，只能靠这个）。⚠️ 每读一个视频消耗 1 次「看视频额度」，所以先看标题和简介判断值不值得花。"
      : "读 B 站视频字幕。⚠️ 现在没有登录 B 站，拿不到字幕——如果对方问视频内容，只能看简介，并说明读不到字幕。",
    parameters: {
      type: "object",
      properties: {
        bvid: { type: "string", description: "形如 BV1d8pU6xEZX" },
        maxChars: { type: "integer", description: "最多返回多少字，默认 2500" },
      },
      required: ["bvid"],
    },
    handler: async (args) => {
      const bvid = String(args.bvid ?? "").trim();
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return { ok: false, text: `BV 号格式不对：${bvid}` };
      if (!hasLogin) {
        return {
          ok: false,
          text: "没有登录 B 站，拿不到字幕。只能先用 bili_info 看简介，并如实告诉对方读不到视频内容。",
        };
      }

      // 今天已经看过这个就不再花额度——同一个视频看两遍是纯浪费
      if (opts.db) {
        const today = new Date().toISOString().slice(0, 10);
        const seen = opts.db
          .prepare("SELECT title FROM watched_videos WHERE day = ? AND bvid = ?")
          .get(today, bvid) as { title: string } | undefined;
        if (seen) {
          return { ok: false, text: `「${seen.title || bvid}」今天已经看过了，换一个吧（这次没花额度）` };
        }
      }

      // 额度：videoQuota <= 0 表示不限量——只记录看过什么，不拦
      const limit = opts.videoQuota ?? 20;
      const unlimited = limit <= 0;
      let remainingAfter = -1;
      if (opts.db) {
        if (!unlimited) {
          const left = quotaRemaining(opts.db, "video", limit);
          if (left <= 0) {
            return { ok: false, text: `今天能看的 ${limit} 个视频已经看完了。剩下的先记着，明天再看。` };
          }
          remainingAfter = quotaSpend(opts.db, "video", limit);
        } else {
          quotaSpend(opts.db, "video", 0);
        }
        opts.db
          .prepare("INSERT OR REPLACE INTO watched_videos (day, bvid, title, watched_at) VALUES (?, ?, ?, ?)")
          .run(new Date().toISOString().slice(0, 10), bvid, "", Date.now());
      }
      try {
        const view = await api<{ code: number; data?: { aid: number; title?: string; pages?: Array<{ cid: number }> } }>(
          `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
          opts,
        );
        const aid = view.data?.aid;
        const cid = view.data?.pages?.[0]?.cid;
        // 标题后补：插入额度记录时还没取到 view，这里把标题写回去
        if (opts.db && view.data?.title) {
          opts.db
            .prepare("UPDATE watched_videos SET title = ? WHERE day = ? AND bvid = ?")
            .run(view.data.title, new Date().toISOString().slice(0, 10), bvid);
        }
        if (!aid || !cid) return { ok: false, text: "查不到这个视频的分P信息" };

        const player = await api<{
          code: number;
          data?: { subtitle?: { subtitles?: Array<{ lan?: string; subtitle_url?: string }> } };
        }>(`https://api.bilibili.com/x/player/wbi/v2?${signWbi({ aid, cid }, await getWbiKeys(opts))}`, opts);
        const subs = player.data?.subtitle?.subtitles ?? [];
        if (subs.length === 0) return { ok: false, text: "这个视频没有字幕（可能是纯音乐、或UP主没上传字幕）" };

        const pick = subs.find((s) => (s.lan ?? "").startsWith("zh")) ?? subs[0]!;
        const url = pick.subtitle_url ?? "";
        if (url.length === 0) return { ok: false, text: "字幕地址是空的" };

        const body = await api<{ body?: Array<{ content?: string }> }>(
          url.startsWith("//") ? `https:${url}` : url,
          opts,
        );
        const text = (body.body ?? [])
          .map((b) => (b.content ?? "").trim())
          .filter((s) => s.length > 0)
          .join("")
          .replace(/\s+/g, "");
        if (text.length === 0) return { ok: false, text: "字幕内容是空的" };
        const max = Math.max(500, Number(args.maxChars) || 2500);
        const cut = text.length > max ? `${text.slice(0, max)}…（后面还有 ${text.length - max} 字）` : text;
        const quotaNote = opts.db && remainingAfter >= 0 ? `　（今天还能看 ${remainingAfter} 个）` : "";
        return { ok: true, text: `字幕（${pick.lan ?? "未知语言"}，共 ${text.length} 字）${quotaNote}：\n${cut}` };
      } catch (err) {
        return { ok: false, text: `读字幕失败：${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
  registry.register(subtitle);

  // ───────── 搜索 ─────────

  const search: ToolDefinition = {
    name: "bili_search",
    description: "在 B 站按关键词搜视频，按最新发布排序。想找某个主题的视频时用这个（比翻热门榜精准）。",
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "搜索词" },
        count: { type: "integer", description: "要几条，默认 8" },
      },
      required: ["keyword"],
    },
    handler: async (args) => {
      const keyword = String(args.keyword ?? "").trim();
      if (keyword.length === 0) return { ok: false, text: "没说要搜什么" };
      const n = Math.min(20, Math.max(1, Number(args.count) || 8));
      try {
        const keys = await getWbiKeys(opts);
        const signed = signWbi({ search_type: "video", keyword, page: 1, page_size: n, order: "pubdate" }, keys);
        const res = await api<{
          code: number;
          data?: { result?: Array<{ bvid: string; title: string; author: string; play: number; pubdate: number }> };
        }>(`https://api.bilibili.com/x/web-interface/wbi/search/type?${signed}`, opts);
        if (res.code !== 0) return { ok: false, text: `搜索被拦了（code ${res.code}），可能太频繁，过会儿再试` };
        const list = res.data?.result ?? [];
        if (list.length === 0) return { ok: true, text: `没搜到「${keyword}」的视频` };
        const lines = list.map((v, i) => {
          const title = v.title.replace(/<[^>]+>/g, "");
          const date = new Date(v.pubdate * 1000).toISOString().slice(0, 10);
          return `${i + 1}. ${date}　${title}　${v.author}　(${v.bvid})`;
        });
        return { ok: true, text: `搜「${keyword}」最新 ${lines.length} 条：\n${lines.join("\n")}` };
      } catch (err) {
        return { ok: false, text: `搜索失败：${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
  registry.register(search);

  // ───────── 写操作 ─────────
  //
  // 这些是对外可见的动作。默认**不设次数上限**——她要发就发。
  // 只在配置里显式给了正数（biliDailyWriteLimit）时才按那个数字拦。

  const writeGuard = (limit: number): { ok: true; jct: string } | { ok: false; text: string } => {
    if (!hasJct) return { ok: false, text: "没有配置 bili_jct，做不了写操作（点赞/评论/弹幕/动态都需要它）" };
    if (limit > 0) {
      const budget = writeBudget(limit);
      if (!budget.ok) {
        return { ok: false, text: `今天已经做了 ${budget.used} 次写操作，到上限了，明天再说` };
      }
    }
    return { ok: true, jct: opts.jct ?? "" };
  };

  const like: ToolDefinition = {
    name: "bili_like",
    description:
      "给 B 站视频点赞（或取消）。想点赞就点。看到值得的就点一个。",
    parameters: {
      type: "object",
      properties: {
        bvid: { type: "string", description: "视频 BV 号" },
        undo: { type: "boolean", description: "true 表示取消点赞" },
      },
      required: ["bvid"],
    },
    handler: async (args) => {
      const guard = writeGuard(opts.dailyWriteLimit ?? 20);
      if (!guard.ok) return { ok: false, text: guard.text };
      const bvid = String(args.bvid ?? "").trim();
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return { ok: false, text: `BV 号格式不对：${bvid}` };
      try {
        const view = await api<{ code: number; data?: { aid: number } }>(
          `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
          opts,
        );
        const aid = view.data?.aid;
        if (!aid) return { ok: false, text: "查不到这个视频" };
        const undo = args.undo === true;
        const res = await postForm<{ code: number; message?: string }>(
          "https://api.bilibili.com/x/web-interface/archive/like",
          { aid, like: undo ? 0 : 1, csrf: guard.jct },
          opts,
        );
        if (res.code !== 0) return { ok: false, text: `点赞失败：${res.message ?? res.code}（code ${res.code}）` };
        countWrite();
        return { ok: true, text: undo ? `已取消点赞 ${bvid}` : `已点赞 ${bvid}` };
      } catch (err) {
        return { ok: false, text: `点赞出错：${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
  registry.register(like);

  /**
   * 对外可见的动作，先问他一句。
   * 返回 null 表示不用问（已经批准过，或者关掉了请示）。
   */
  const askFirst = (
    kind: "comment" | "danmaku" | "dynamic",
    bvid: string,
    payload: string,
    what: string,
    args: Record<string, unknown>,
  ): { ok: boolean; text: string } | null => {
    if (args._approved === true) return null;
    if (opts.approvalRequired === false) return null;
    if (!opts.db) return null;
    const ap = createApproval(opts.db, { kind, bvid, payload, what });
    opts.notify?.(ap.message);
    return {
      ok: true,
      text: `这个要先问过他（编号 ${ap.shortId}），已经发过去了。他没回之前别再问一遍。`,
    };
  };

  const comment: ToolDefinition = {
    name: "bili_comment",
    description:
      "在 B 站视频下发表评论。想说什么就说。这是你自己的评论区。",
    parameters: {
      type: "object",
      properties: {
        bvid: { type: "string", description: "视频 BV 号" },
        text: { type: "string", description: "评论内容" },
      },
      required: ["bvid", "text"],
    },
    handler: async (args) => {
      const guard = writeGuard(opts.dailyWriteLimit ?? 20);
      if (!guard.ok) return { ok: false, text: guard.text };
      const bvid = String(args.bvid ?? "").trim();
      const text = String(args.text ?? "").trim();
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return { ok: false, text: `BV 号格式不对：${bvid}` };
      if (text.length === 0) return { ok: false, text: "评论内容是空的" };
      if (text.length > 500) return { ok: false, text: "评论太长了（B站限制 500 字以内）" };
      const askComment = askFirst("comment", bvid, JSON.stringify({ bvid, text }), `在 ${bvid} 下评论「${text.slice(0, 40)}」`, args);
      if (askComment) return askComment;
      try {
        const view = await api<{ code: number; data?: { aid: number } }>(
          `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
          opts,
        );
        const aid = view.data?.aid;
        if (!aid) return { ok: false, text: "查不到这个视频" };
        const res = await postForm<{ code: number; message?: string }>(
          "https://api.bilibili.com/x/v2/reply/add",
          { oid: aid, type: 1, message: text, csrf: guard.jct },
          opts,
        );
        if (res.code !== 0) return { ok: false, text: `评论失败：${res.message ?? res.code}（code ${res.code}）` };
        countWrite();
        return { ok: true, text: `已在 ${bvid} 发评论：${text.slice(0, 30)}` };
      } catch (err) {
        return { ok: false, text: `发评论出错：${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
  registry.register(comment);

  const danmaku: ToolDefinition = {
    name: "bili_danmaku",
    description:
      "给 B 站视频发一条弹幕。想说就在那一秒发一条。",
    parameters: {
      type: "object",
      properties: {
        bvid: { type: "string", description: "视频 BV 号" },
        text: { type: "string", description: "弹幕内容，短一点更好" },
        atSec: { type: "integer", description: "出现在第几秒，默认 5" },
      },
      required: ["bvid", "text"],
    },
    handler: async (args) => {
      const guard = writeGuard(opts.dailyWriteLimit ?? 20);
      if (!guard.ok) return { ok: false, text: guard.text };
      const bvid = String(args.bvid ?? "").trim();
      const text = String(args.text ?? "").trim();
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return { ok: false, text: `BV 号格式不对：${bvid}` };
      if (text.length === 0) return { ok: false, text: "弹幕内容是空的" };
      if (text.length > 100) return { ok: false, text: "弹幕太长了（100 字以内）" };
      const askDm = askFirst("danmaku", bvid, JSON.stringify({ bvid, text, atSec: Number(args.atSec) || 5 }), `在 ${bvid} 第 ${Number(args.atSec) || 5} 秒发弹幕「${text.slice(0, 40)}」`, args);
      if (askDm) return askDm;
      const atSec = Math.max(0, Number(args.atSec) || 5);
      try {
        const view = await api<{ code: number; data?: { aid: number; pages?: Array<{ cid: number }> } }>(
          `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
          opts,
        );
        const aid = view.data?.aid;
        const cid = view.data?.pages?.[0]?.cid;
        if (!aid || !cid) return { ok: false, text: "查不到这个视频的分P信息" };
        const res = await postForm<{ code: number; message?: string }>(
          "https://api.bilibili.com/x/v2/dm/post",
          {
            type: 1,
            oid: cid,
            bvid,
            msg: text,
            progress: atSec * 1000,
            mode: 1,
            fontsize: 25,
            color: 16777215,
            pool: 0,
            csrf: guard.jct,
          },
          opts,
        );
        if (res.code !== 0) return { ok: false, text: `发弹幕失败：${res.message ?? res.code}（code ${res.code}）` };
        countWrite();
        return { ok: true, text: `已在 ${bvid} 第 ${atSec} 秒发弹幕：${text}` };
      } catch (err) {
        return { ok: false, text: `发弹幕出错：${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
  registry.register(danmaku);

  const dynamic: ToolDefinition = {
    name: "bili_dynamic",
    description:
      "发一条 B 站动态（类似微博，粉丝能看到）。想发就发。这是你自己的动态。",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "动态内容" } },
      required: ["text"],
    },
    handler: async (args) => {
      const guard = writeGuard(opts.dailyWriteLimit ?? 20);
      if (!guard.ok) return { ok: false, text: guard.text };
      const text = String(args.text ?? "").trim();
      if (text.length === 0) return { ok: false, text: "动态内容是空的" };
      if (text.length > 2000) return { ok: false, text: "动态太长了" };
      const askDyn = askFirst("dynamic", "", JSON.stringify({ text }), `发一条动态「${text.slice(0, 40)}」`, args);
      if (askDyn) return askDyn;
      try {
        const dynDatas = JSON.stringify({ dyn_id_str: "", dyn_type: 1, rid: 0, content: text, ctrl: [] });
        const res = await postForm<{ code: number; message?: string }>(
          "https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/create",
          { dyn_datas: dynDatas, csrf: guard.jct },
          opts,
        );
        if (res.code !== 0) return { ok: false, text: `发动态失败：${res.message ?? res.code}（code ${res.code}）` };
        countWrite();
        return { ok: true, text: `已发动态：${text.slice(0, 30)}` };
      } catch (err) {
        return { ok: false, text: `发动态出错：${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
  registry.register(dynamic);
}
