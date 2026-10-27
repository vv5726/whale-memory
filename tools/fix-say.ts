import { readFileSync, writeFileSync } from "node:fs";

/**
 * 修 say() 里残留的 evt。
 *
 * 之前把 handle() 的片段错插进了 say()，而 say(text, userName) 根本没有 evt 参数。
 * 只在 say(...) 到 handle(...) 这一段里替换，不碰 handle。
 */
const p = "src/bot/service.ts";
let s = readFileSync(p, "utf8");

const a = s.indexOf("async say(");
const b = s.indexOf("async handle(");
if (a < 0 || b < 0 || b <= a) {
  console.log("定位失败：", a, b);
  process.exit(1);
}

let seg = s.slice(a, b);
const before = (seg.match(/evt\./g) ?? []).length;

seg = seg
  .replace(/String\(evt\.userId\)/g, '""')
  .replace(/evt\.userId/g, '""')
  .replace(/\(evt as \{ sender\?: \{ card\?: string; nickname\?: string \} \}\)\.sender/g, "undefined")
  .replace(/evt\.isGroup/g, "false")
  .replace(/evt\.groupId/g, "0");

const after = (seg.match(/evt\./g) ?? []).length;
writeFileSync(p, s.slice(0, a) + seg + s.slice(b), "utf8");
console.log(`say() 里 evt 引用：${before} → ${after}`);
