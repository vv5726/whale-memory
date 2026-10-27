/**
 * B 站 wbi 签名 + 字幕可取性测试。
 *
 * 关键疑问：不带 wbi 签名请求 player/v2，返回的 subtitle_url 每次都不一样
 * （内容也跟视频无关）——看起来是「没授权时给个随机字幕」。
 * 这里验证签名后是否变成稳定且正确的那一条。
 */
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

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

async function getWbiKeys(): Promise<{ imgKey: string; subKey: string }> {
  const nav = await get<{ data?: { wbi_img?: { img_url?: string; sub_url?: string } } }>(
    "https://api.bilibili.com/x/web-interface/nav",
  );
  const img = nav.data?.wbi_img?.img_url ?? "";
  const sub = nav.data?.wbi_img?.sub_url ?? "";
  const base = (u: string): string => (u.split("/").pop() ?? "").split(".")[0] ?? "";
  return { imgKey: base(img), subKey: base(sub) };
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

async function main(): Promise<void> {
  const bvid = process.argv[2] ?? "BV1d8pU6xEZX";
  const keys = await getWbiKeys();
  console.log(`wbi keys 拿到：img=${keys.imgKey.slice(0, 8)}… sub=${keys.subKey.slice(0, 8)}…`);

  const view = await get<{ data?: { aid: number; title: string; pages?: Array<{ cid: number }> } }>(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
  );
  const aid = view.data?.aid ?? 0;
  const cid = view.data?.pages?.[0]?.cid ?? 0;
  console.log(`视频：${view.data?.title}\n`);

  for (const label of ["不带签名", "带签名"] as const) {
    const url =
      label === "带签名"
        ? `https://api.bilibili.com/x/player/wbi/v2?${signWbi({ aid, cid }, keys)}`
        : `https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`;
    const p = await get<{
      code: number;
      data?: { subtitle?: { subtitles?: Array<{ lan?: string; subtitle_url?: string }> } };
    }>(url);
    const subs = p.data?.subtitle?.subtitles ?? [];
    const su = subs[0]?.subtitle_url ?? "";
    const tail = su.split("?")[0].split("/").pop() ?? "";
    console.log(`${label}：字幕 ${subs.length} 条　url 尾巴=${tail.slice(-28)}`);
    if (su.length > 0) {
      const body = await get<{ body?: Array<{ content?: string }> }>(su.startsWith("//") ? `https:${su}` : su);
      const text = (body.body ?? []).map((b) => b.content ?? "").join("");
      console.log(`        共 ${body.body?.length ?? 0} 句　开头：${text.slice(0, 60)}`);
    }
  }
}

await main();
