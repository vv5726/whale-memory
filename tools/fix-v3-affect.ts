import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract-v3.ts";
let s = readFileSync(p, "utf8");
const target = "affect: { valence: 0, arousal: 0.3, tags: [], summary: null },";
const fixed = 'affect: { valence: 0, arousal: 0.3, tags: [], summary: "" },';

if (s.includes(fixed)) {
  console.log("已经是空字符串了，不用改");
} else if (s.includes(target)) {
  s = s.replace(target, fixed);
  writeFileSync(p, s, "utf8");
  console.log("已修：affect.summary null → ''");
} else {
  const line = s.split("\n").find((l) => l.includes("affect:"));
  console.log("没匹配到，实际那行是：" + String(line).trim());
}
