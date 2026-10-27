import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";

/**
 * 「这一条消息带原图」——只在**当前这一轮**把图片作为多模态内容发给模型。
 *
 * 为什么这么做：
 *  - 以前只有本地 7B 写的文字描述，她等于在看别人的转述，表情包细节全丢；
 *  - 但历史里不能存图（每张几百到上千 tokens，几十轮就爆上下文），
 *    所以：原图只进「这一轮的最后一条 user 消息」，历史照旧只留文字描述。
 *
 * 用法（只在 handle 里用一次）：
 *   setPendingImages(files)  →  chatApi 第一次请求时自动注入  →  注入后立刻清空
 * 这样即使她这一轮要调工具、重试，也只有第一次请求带原图，不会反复烧 token。
 */

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

interface Pending {
  file: string;
  dataUrl: string;
}

let pending: Pending[] = [];

const MAX_IMAGES = 3;
/** 单张上限：太大的图 base64 会让请求体爆掉 */
const MAX_BYTES = 4 * 1024 * 1024;

function mimeOf(file: string): string {
  const ext = extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  return "image/jpeg";
}

export function setPendingImages(files: string[]): void {
  pending = [];
  for (const file of files.slice(0, MAX_IMAGES)) {
    try {
      if (!existsSync(file)) continue;
      const buf = readFileSync(file);
      if (buf.length === 0 || buf.length > MAX_BYTES) continue;
      pending.push({ file, dataUrl: `data:${mimeOf(file)};base64,${buf.toString("base64")}` });
    } catch {
      // 读不到就当没有
    }
  }
}

export function clearPendingImages(): void {
  pending = [];
}

export function pendingImageCount(): number {
  return pending.length;
}

/**
 * 把挂着的图片注入最后一条 user 消息（content 变成数组）。
 * 注入一次就清空——所以后面几轮工具调用/重试都不会重复带图。
 * 没有挂图时原样返回，调用方不用改。
 */
export function injectPendingImages<T extends { role: string; content: string | Part[] }>(messages: T[]): T[] {
  if (pending.length === 0) return messages;
  let target = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      target = i;
      break;
    }
  }
  if (target < 0) {
    pending = [];
    return messages;
  }
  const text = typeof messages[target].content === "string" ? messages[target].content : "";
  const parts: Part[] = [{ type: "text", text }];
  for (const p of pending) parts.push({ type: "image_url", image_url: { url: p.dataUrl } });
  const out = messages.slice();
  out[target] = { role: messages[target].role, content: parts } as T;
  pending = [];
  return out;
}
