/** 端到端测眼睛：给一段带图片 CQ 码的消息，看它变成什么 */
import { describeImagesInText } from "../src/vision.ts";
import { describeCqCodes } from "../src/cqcode.ts";
import { readdirSync } from "node:fs";

const shots = readdirSync("data/screenshots").filter((f) => f.endsWith(".png"));
if (shots.length === 0) {
  console.log("没有测试图");
  process.exit(1);
}

// 用本地文件路径伪造 url（file:// 不行，改用 data URI 太慢）——直接测函数链
const file = `data/screenshots/${shots[0]}`;
console.log(`用本地图测：${file}`);

const { describeImage } = await import("../src/vision.ts");
const r = await describeImage(file);
console.log(`  识别：${r.ok ? "成功" : "失败"}，${r.ms}ms`);
console.log(`  ${r.text.slice(0, 200)}`);

// 测文本替换（不含真实下载，用 summary 兜底）
const fake = "[CQ:image,file=abc.jpg,summary=一张截图]";
console.log(`  纯文本处理：${describeCqCodes(fake)}`);
