/** 端到端：本地图 → 事实层 → 意思层 */
import { describeImage } from "../src/vision.ts";
import { interpretImage } from "../src/vision-meaning.ts";
import { readdirSync } from "node:fs";

const shots = readdirSync("data/screenshots").filter((f) => f.endsWith(".png"));
const file = `data/screenshots/${shots[shots.length - 1]}`;
console.log(`测试图：${file}`);

const r = await describeImage(file);
console.log(`事实层（${r.ms}ms）：${r.text.slice(0, 120)}`);

const meaning = await interpretImage("data", r.text, "他 在群里说「你又卡了」，然后发了这张图");
console.log(`意思层：${meaning.length > 0 ? meaning : "（没返回）"}`);

if (r.ok) {
  console.log("");
  console.log(`合并后她会看到：`);
  console.log(`  [发了一张图｜图里：${r.text.replace(/\s+/g, " ").slice(0, 80)}｜可能是：${meaning}]`);
}
