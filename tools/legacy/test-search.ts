/** 测试 B 站搜索接口（需要 wbi 签名） */
import { createHash } from "node:crypto";
import { loadBotConfig } from "../src/bot/config.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52,
];

const cfg = loadBotConfig();
const COOKIE = `SESSDATA=${cfg.biliSessdata}`;

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://www.bilibili.com", Cookie: COOKIE } });
  return (await res.json()) as T;
}

const md5 = (s: string): string => createHash("md5").update(s).digest("hex");

async function main(): Promise<void> {
  const nav = await get<{ data?: { wbi_img?: { img_url?: string; sub_url?: string } } }>(
    "https://api.bilibili.com/x/web-interface/nav",
  );
  const base = (u: string): string => (u.split("/").pop() ?? "").split(".")[0] ?? "";
  const raw = base(nav.data?.wbi_img?.img_url ?? "") + base(nav.data?.wbi_img?.sub_url ?? "");
  const mixin = MIXIN_TAB.map((i) => raw[i] ?? "").join("").slice(0, 32);

  const keyword = process.argv[2] ?? "deepseek";
  const wts = Math.round(Date.now() / 1000);
  const params: Record<string, string | number> = {
    search_type: "video",
    keyword,
    page: 1,
    page_size: 10,
    order: "pubdate",
    wts,
  };
  const query = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]).replace(/[!'()*]/g, ""))}`)
    .join("&");
  const signed = `${query}&w_rid=${md5(query + mixin)}`;

  const res = await get<{
    code: number;
    message?: string;
    data?: { result?: Array<{ bvid: string; title: string; author: string; play: number; pubdate: number }> };
  }>(`https://api.bilibili.com/x/web-interface/wbi/search/type?${signed}`);

  console.log(`code=${res.code} message=${res.message ?? ""}`);
  const list = res.data?.result ?? [];
  console.log(`搜「${keyword}」得到 ${list.length} 条：`);
  for (const v of list.slice(0, 8)) {
    const title = v.title.replace(/<[^>]+>/g, "");
    const date = new Date(v.pubdate * 1000).toISOString().slice(0, 10);
    console.log(`  ${date}  ${title.slice(0, 40)}  ${v.author}  ${v.play}播放  (${v.bvid})`);
  }
}

await main();
