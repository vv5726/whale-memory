/**
 * 验证「一个表情/一张图只解读一次」。
 *
 * 线上症状：一个 QQ 自带表情包被读成「两个 524，同一个表情发了两遍」。
 * 两层都要修：
 *   ① cqcode：同一句里同一个 face id 只描述一次（NapCat 会给重复段）
 *   ② vision：同一句里同一张图只跑一次「看图 + 读意思」，别花两次模型调用
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describeCqCodes } from "../src/cqcode.ts";
import { describeImagesInText } from "../src/vision.ts";

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

// ── ① 表情：同一个 id 只算一次 ──
console.log("=== ① 表情去重 ===");
const one = describeCqCodes("[CQ:face,id=524,faceText=/自闭]");
const dupAdj = describeCqCodes("[CQ:face,id=524][CQ:face,id=524]");
const dupSplit = describeCqCodes("那再来一次[CQ:face,id=467][CQ:face,id=467]");
const twoDifferent = describeCqCodes("[CQ:face,id=467][CQ:face,id=524]");
console.log(`  一个：${one}`);
console.log(`  重复（相邻）：${dupAdj}`);
console.log(`  重复（带文字）：${dupSplit}`);
console.log(`  两个不同的：${twoDifferent}`);
check("一个表情就是一个", count(one, "发了个表情") === 1);
check("相邻重复段只算一次", count(dupAdj, "发了个表情") === 1);
check("中间夹着字也只算一次", count(dupSplit, "发了个表情") === 1);
check("两个不同 id 都保留", count(twoDifferent, "发了个表情") === 2);

// ── ② 图片/表情包：同一张图只解读一次 ──
console.log("\n=== ② 同一张图只解读一次 ===");
const dataDir = "data/tmp-vision-check";
mkdirSync(dataDir, { recursive: true });
// 意思层要有 key 才会真去调 —— 这里放个假的，才能数调用次数
writeFileSync(join(dataDir, "bot.json"), JSON.stringify({ deepseekApiKey: "test-key" }), "utf8");

const realFetch = globalThis.fetch;
let visionCalls = 0;
let meaningCalls = 0;
const bytes = Buffer.from("fake-png-bytes-for-hash");

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(typeof input === "object" && "url" in input ? (input as Request).url : input);
  if (url.includes("/api/generate")) {
    visionCalls++;
    return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
  }
  if (url.includes("/chat/completions")) {
    meaningCalls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "有点无语，或是在敷衍你" } }] }),
    } as unknown as Response;
  }
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(0) } as unknown as Response;
}) as typeof fetch;

const imgCq = "[CQ:image,file=abc.png,url=http%3A%2F%2Fx%2Fa.png,summary=动画表情]";
try {
  const once = await describeImagesInText(`他发了一句 ${imgCq}`, dataDir);
  // 数第二段之前先清零：要验的是「同一条里重复两段」这一趟花了多少次调用
  visionCalls = 0;
  meaningCalls = 0;
  const twice = await describeImagesInText(`${imgCq}${imgCq}`, dataDir);

  console.log(`  一张：${once}`);
  console.log(`  同一条里重复两段：${twice}`);
  check("一张图只保留一个描述", count(once, "发了一张图") === 1);
  check("重复段被丢掉，不是拼两遍", count(twice, "发了一张图") === 1);
  check("同一张图只读了 1 次意思", meaningCalls === 1, `实际 ${meaningCalls} 次`);
  check("同一张图只问了 1 次眼睛（失败的也算一次）", visionCalls === 1, `实际 ${visionCalls} 次`);
} finally {
  globalThis.fetch = realFetch;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
