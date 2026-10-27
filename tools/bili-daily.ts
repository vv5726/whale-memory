/**
 * B 站日报：拉热门榜 → 让模型挑出值得看的 → 写一份 markdown。
 *
 * 抄的是 dsh-bili-scroll 的思路：不是把榜单原样倒给你，
 * 而是**先筛一遍**，每条给一句「为什么值得看」。
 *
 * 用法：
 *   node tools/bili-daily.ts                # 默认 20 条里挑 3 条
 *   node tools/bili-daily.ts --pick 5       # 挑 5 条
 *   node tools/bili-daily.ts --no-llm       # 不调模型，只按数据排序
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBotConfig } from "../src/bot/config.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface Video {
  bvid: string;
  title: string;
  owner?: { name?: string };
  duration?: number;
  stat?: { view?: number; like?: number; danmaku?: number };
  desc?: string;
  pubdate?: number;
}

function fmtCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return String(n);
}

async function fetchHot(ps: number): Promise<Video[]> {
  const res = await fetch(`https://api.bilibili.com/x/web-interface/popular?ps=${ps}&pn=1`, {
    headers: { "User-Agent": UA, Referer: "https://www.bilibili.com" },
  });
  const data = (await res.json()) as { code: number; data?: { list?: Video[] } };
  if (data.code !== 0) throw new Error(`热门接口返回 ${data.code}（可能被风控）`);
  return data.data?.list ?? [];
}

function cleanTitle(t: string): string {
  return t.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const pickIdx = argv.indexOf("--pick");
  const pick = pickIdx >= 0 ? Math.max(1, Number(argv[pickIdx + 1]) || 3) : 3;
  const useLlm = !argv.includes("--no-llm");

  console.log("拉热门榜……");
  const list = await fetchHot(20);
  console.log(`拿到 ${list.length} 条\n`);

  const candidates = list
    .filter((v) => (v.duration ?? 0) >= 60) // 太短的（预告片、切片）先排除
    .map((v) => ({
      bvid: v.bvid,
      title: cleanTitle(v.title),
      up: v.owner?.name ?? "未知",
      view: v.stat?.view ?? 0,
      like: v.stat?.like ?? 0,
      duration: v.duration ?? 0,
      desc: (v.desc ?? "").replace(/\s+/g, " ").slice(0, 200),
    }));

  let chosen: Array<{ index: number; reason: string }> = [];
  let note = "";

  if (useLlm) {
    const cfg = loadBotConfig();
    if (cfg.deepseekApiKey.length === 0) {
      console.log("没有 DeepSeek key，退回按数据排序\n");
      note = "（未使用模型筛选：没有配置 API key）";
    } else {
      const adapter = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);
      const numbered = candidates
        .map((v, i) => `${i + 1}. ${v.title}（${v.up}，${fmtCount(v.view)}播放，${Math.round(v.duration / 60)}分钟）简介：${v.desc || "无"}`)
        .join("\n");

      const raw = await adapter.complete(
        [
          {
            role: "system",
            content: [
              `你是替我筛视频的人。下面是 B 站今天的热门榜，挑 ${pick} 条我可能真的想看的。`,
              "偏好：有信息量、有观点、有制作水平；不要纯情绪、不要标题党、不要游戏预告片、不要明星八卦。",
              "如果确实没值得的，宁可挑少一点。",
              '只输出 JSON：{"picks":[{"index":序号,"reason":"一句话说为什么值得看，二十字内"}]}',
            ].join("\n"),
          },
          { role: "user", content: numbered },
        ],
        { json: true, timeoutMs: 60_000 },
      );

      try {
        const parsed = JSON.parse(raw.replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim()) as {
          picks?: Array<{ index?: number; reason?: string }>;
        };
        chosen = (parsed.picks ?? [])
          .map((p) => ({ index: Number(p.index) - 1, reason: String(p.reason ?? "").slice(0, 40) }))
          .filter((p) => Number.isInteger(p.index) && p.index >= 0 && p.index < candidates.length)
          .slice(0, pick);
      } catch {
        note = "（模型输出解析失败，退回按播放量排序）";
      }
    }
  }

  if (chosen.length === 0) {
    chosen = candidates.slice(0, pick).map((_, i) => ({ index: i, reason: "热门榜靠前" }));
  }

  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`# B站日报 ${date}`, "", `> 从 ${candidates.length} 条热门里挑出 ${chosen.length} 条${note}`, ""];
  for (const c of chosen) {
    const v = candidates[c.index]!;
    lines.push(`### ${v.bvid}`);
    lines.push(`**${v.title}**`);
    lines.push(`- UP：${v.up}　播放：${fmtCount(v.view)}　点赞：${fmtCount(v.like)}　时长：${Math.round(v.duration / 60)} 分钟`);
    lines.push(`- 为什么值得：${c.reason}`);
    lines.push(`- https://www.bilibili.com/video/${v.bvid}`);
    lines.push("");
  }

  const text = lines.join("\n");
  console.log(text);

  const dir = join("data", "bili-reports");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${date}.md`);
  writeFileSync(path, text, "utf8");
  console.log(`已保存：${path}`);
}

await main();
