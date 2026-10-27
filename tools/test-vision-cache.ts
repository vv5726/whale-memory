/** 验证：同一张图连续来两次，第二次不该再描述 */
import { remembered, remember } from "../src/vision-cache.ts";

const dataDir = "data";
const hash = "testhash" + Date.now().toString(36);

console.log("① 第一次见：", remembered(dataDir, hash) === null ? "没有记录（会去描述）" : "有记录");

remember(dataDir, hash, "一只橘猫趴在键盘上");
console.log("② 记住了之后：", remembered(dataDir, hash));

const old = Date.now() - 11 * 60_000;
const cache = { [hash + "old"]: { desc: "很久以前的图", at: old } };
const fs = await import("node:fs");
fs.writeFileSync(`${dataDir}/vision-cache.json`, JSON.stringify(cache), "utf8");
console.log("③ 十一分钟前的记录：", remembered(dataDir, hash + "old") === null ? "过期，会重新描述" : "还在");
