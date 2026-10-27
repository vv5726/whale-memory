/** 带登录态检查一批视频有没有字幕 */
import { loadBotConfig } from "../src/bot/config.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const cfg = loadBotConfig();

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Referer: "https://www.bilibili.com",
      Cookie: `SESSDATA=${cfg.biliSessdata}`,
    },
  });
  return (await res.json()) as T;
}

async function check(bvid: string): Promise<void> {
  const view = await get<{ code: number; data?: { aid: number; title: string; pages?: Array<{ cid: number }> } }>(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
  );
  if (view.code !== 0 || !view.data) {
    console.log(`${bvid}  查不到`);
    return;
  }
  const aid = view.data.aid;
  const cid = view.data.pages?.[0]?.cid ?? 0;
  const p = await get<{
    code: number;
    data?: { subtitle?: { subtitles?: Array<{ lan?: string; subtitle_url?: string }> } };
  }>(`https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`);
  const subs = p.data?.subtitle?.subtitles ?? [];
  const title = view.data.title.slice(0, 24);
  if (subs.length === 0) {
    console.log(`${bvid}  字幕 0　${title}`);
    return;
  }
  console.log(`${bvid}  字幕 ${subs.length} 条 (${subs.map((s) => s.lan).join(",")})　${title}`);
  // 拉第一条看看能不能读
  const url = subs[0]!.subtitle_url ?? "";
  if (url.length === 0) return;
  const body = await get<{ body?: Array<{ content?: string }> }>(url.startsWith("//") ? `https:${url}` : url);
  const text = (body.body ?? []).map((b) => b.content ?? "").join("");
  console.log(`      正文 ${text.length} 字：${text.slice(0, 80)}…`);
}

const bvs = process.argv.slice(2);
for (const bv of bvs) {
  try {
    await check(bv);
  } catch (err) {
    console.log(`${bv}  出错：${err instanceof Error ? err.message : String(err)}`);
  }
}
