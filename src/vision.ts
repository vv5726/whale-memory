import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { createHash } from "node:crypto";
import { remember, remembered } from "./vision-cache.ts";
import { interpretImage } from "./vision-meaning.ts";
import { loadBotConfig } from "./bot/config.ts";

/**
 * 眼睛。
 *
 * 两层：
 *  1. 描述层（这张图里有什么）——优先 DeepSeek 多模态，失败退回本机 qwen2.5vl:7b；
 *  2. 意思层（发这张图可能想表达什么）——DeepSeek 想（vision-meaning.ts）。
 *
 * 为什么先走 DeepSeek：本机 7b 看图会漏字、把「Stickers」读成「Sticker」、
 * 分不清表情是笑还是嘲；同样的图 DeepSeek 只要 ~200 tokens（一张不到一分钱），
 * 描述准得多。本地只当断网/没 key 时的兜底——不花钱，但看得糙。
 */
const OLLAMA = "http://127.0.0.1:11434";
const MODEL = "qwen2.5vl:7b";

export interface VisionResult {
  ok: boolean;
  text: string;
  ms: number;
  /** 哪个后端看的：deepseek / local */
  backend?: "deepseek" | "local";
}

function toBase64(file: string): string {
  return readFileSync(file).toString("base64");
}

function mimeOf(file: string): string {
  const ext = extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  return "image/jpeg";
}

/** DeepSeek 多模态：直接把图发过去看（比本地 7b 准得多） */
export async function describeImageDeepSeek(
  file: string,
  prompt: string,
  cfgOverride?: { deepseekBaseUrl?: string; deepseekApiKey?: string; deepseekModel?: string },
): Promise<VisionResult> {
  const start = Date.now();
  let cfg: { deepseekBaseUrl: string; deepseekApiKey: string; deepseekModel: string };
  try {
    cfg = cfgOverride ? { deepseekBaseUrl: cfgOverride.deepseekBaseUrl ?? "https://api.deepseek.com/v1", deepseekApiKey: cfgOverride.deepseekApiKey ?? "", deepseekModel: cfgOverride.deepseekModel ?? "deepseek-chat" } : loadBotConfig();
  } catch {
    return { ok: false, text: "读不到配置", ms: 0 };
  }
  if (!cfg.deepseekApiKey) return { ok: false, text: "没配 key", ms: 0 };

  try {
    const res = await fetch(`${cfg.deepseekBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.deepseekApiKey}` },
      body: JSON.stringify({
        model: cfg.deepseekModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeOf(file)};base64,${toBase64(file)}` } },
            ],
          },
        ],
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, text: `DeepSeek 看图报错 ${res.status}：${body.slice(0, 120)}`, ms: Date.now() - start };
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    const text = String(json.choices?.[0]?.message?.content ?? "").trim();
    if (text.length === 0) return { ok: false, text: json.error?.message ?? "模型没说话", ms: Date.now() - start };
    return { ok: true, text, ms: Date.now() - start, backend: "deepseek" };
  } catch (err) {
    return { ok: false, text: `DeepSeek 看图失败：${err instanceof Error ? err.message : String(err)}`, ms: Date.now() - start };
  }
}

/** 用一句话问它图里有什么：先 DeepSeek，失败退回本地 7b */
export async function describeImage(
  file: string,
  prompt = "用两三句话说清这张图：图里有什么、谁在做什么、如果有文字就照抄关键的那几行。",
  cfgOverride?: { deepseekBaseUrl?: string; deepseekApiKey?: string; deepseekModel?: string },
): Promise<VisionResult> {
  const start = Date.now();

  if (!existsSync(file)) {
    return { ok: false, text: `找不到图片：${file}`, ms: 0 };
  }
  const ext = extname(file).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"].includes(ext)) {
    return { ok: false, text: `这个不是图片：${ext}`, ms: 0 };
  }

  // ① 先让更准的看
  const remote = await describeImageDeepSeek(file, prompt, cfgOverride);
  if (remote.ok) return { ...remote, ms: Date.now() - start };

  // ② 兜底：本地 qwen2.5vl
  const local = await describeImageLocal(file, prompt);
  if (local.ok) return { ...local, ms: Date.now() - start, backend: "local" };
  return { ok: false, text: `${remote.text}；本地也没看成：${local.text}`, ms: Date.now() - start };
}

/** 本机 qwen2.5vl 看图（不花钱、不上传，但会漏字） */
export async function describeImageLocal(file: string, prompt = "用两三句话说清这张图：图里有什么、谁在做什么、如果有文字就照抄关键的那几行。"): Promise<VisionResult> {
  const start = Date.now();

  try {
    const body = {
      model: MODEL,
      prompt,
      images: [toBase64(file)],
      stream: false,
      options: { temperature: 0.2 },
    };

    const res = await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      return { ok: false, text: `本地模型报错：${res.status}`, ms: Date.now() - start };
    }

    const json = (await res.json()) as { response?: string };
    const text = String(json.response ?? "").trim();
    if (text.length === 0) return { ok: false, text: "模型没说话", ms: Date.now() - start };

    return { ok: true, text, ms: Date.now() - start, backend: "local" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED")) return { ok: false, text: "眼睛没启动（Ollama 没跑）", ms: Date.now() - start };
    if (msg.includes("aborted") || msg.includes("timeout")) return { ok: false, text: "看图超时了", ms: Date.now() - start };
    return { ok: false, text: `看图失败：${msg}`, ms: Date.now() - start };
  }
}

/** 从 QQ 的 CQ 码里拿图片地址（NapCat 会给 url 或 file） */
export function imageSourceFromCq(cq: string): string | null {
  const m = /\[CQ:image[^\]]*\]/.exec(cq);
  if (!m) return null;
  const url = /url=([^,\]]+)/.exec(m[0]);
  if (url?.[1]) return decodeURIComponent(url[1].replace(/&amp;/g, "&"));
  const file = /file=([^,\]]+)/.exec(m[0]);
  if (file?.[1]) return decodeURIComponent(file[1]);
  return null;
}

export async function describeImagesInText(
  text: string,
  dataDir: string,
  sink?: string[],
  cfgOverride?: { deepseekBaseUrl?: string; deepseekApiKey?: string; deepseekModel?: string },
): Promise<string> {
  const codes = /\[CQ:image,([^\]]*)\]/g;
  const found: Array<{ full: string; url: string; summary: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = codes.exec(text)) !== null) {
    const attrs = m[1] ?? "";
    const url = /url=([^,\]]+)/.exec(attrs)?.[1];
    const summary = /summary=([^,\]]*)/.exec(attrs)?.[1] ?? "";
    if (url) found.push({ full: m[0], url: decodeURIComponent(url.replace(/&amp;/g, "&")), summary });
  }
  if (found.length === 0) return text;

  let out = text;
  // 同一条消息里同一张图只解读一次：NapCat 有时一个表情包给两段，
  // 以前会跑两遍「看图 + 读意思」（两次模型调用），出来的还是同一个描述。
  const labels = new Map<string, string>();
  for (const item of found.slice(0, 3)) {
    try {
      const res = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
      const done = labels.get(hash);
      if (done !== undefined) {
        // 第一份已经带了描述，重复的那一段直接丢掉，别拼第二遍
        out = out.replace(item.full, "");
        continue;
      }
      const file = join(dataDir, "images", hash + ".jpg");
      mkdirSync(join(dataDir, "images"), { recursive: true });
      writeFileSync(file, buf);
      // 把原图路径交给调用方：这一轮聊天时当多模态图片一起发（历史里只留文字描述）
      if (sink) sink.push(file);
      // 描述层：十分钟内见过就复用，不重复跑千问（省钱省时间），
      // 但事实和意思照样各出一条——发第二次也是一种表达。
      let desc = remembered(dataDir, hash) ?? "";
      if (desc.length === 0) {
        const r = await describeImage(file, undefined, cfgOverride);
        // 眼睛没起来的时候别把原因吞成「看不清」——她会照着说「图太糊」，
        // 而真相是本地模型没跑（2026-10-26：Ollama 端口没监听、模型目录是空的）。
        desc = r.ok
          ? r.text.replace(/\s+/g, " ").slice(0, 200)
          : item.summary
            ? `${item.summary}（看图没成功：${r.text}）`
            : `看不清：${r.text}`;
        if (r.ok) remember(dataDir, hash, desc);
      }

      // 意思层：结合最近在聊什么，猜他想表达什么
      const recent = text.replace(/\[CQ:[^\]]*\]/g, " ").replace(/\s+/g, " ").slice(-120);
      const meaning = await interpretImage(dataDir, desc, recent).catch(() => "");

      const label = meaning.length > 0 ? `[发了一张图｜图里：${desc}｜可能是：${meaning}]` : `[发了一张图｜图里：${desc}]`;
      labels.set(hash, label);
      out = out.replace(item.full, label);
    } catch {
      out = out.replace(item.full, item.summary ? `[发了张图：${item.summary}]` : "[发了张图，看不清]");
    }
  }
  return out;
}
