import { readFileSync, writeFileSync } from "node:fs";

const p = "src/bot/autonomy.ts";
let s = readFileSync(p, "utf8");

const oldLine = '      "读一两个就够，别贪。读不完的记下来明天看。",';
const newLines = [
  '      "额度你自己分配：想读几个读几个，读到额度用完也行。",',
  '      "但每一条读过的都要写清楚它讲了什么——读了却不记住，等于白花额度。",',
  '      "读不完的记下来，明天接着读。",',
].join("\n");

if (s.includes(oldLine)) {
  s = s.replace(oldLine, newLines);
  writeFileSync(p, s, "utf8");
  console.log("已放开数量限制");
} else {
  console.log("没匹配到，当前 readTask：");
  const i = s.indexOf("buildReadTask");
  console.log(s.slice(i, i + 700));
}
