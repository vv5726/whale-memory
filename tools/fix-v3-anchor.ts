import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract-v3.ts";
let s = readFileSync(p, "utf8");
const before = s;

// ensureAnchor 需要第 4 个参数 nowTs，漏了 → 绑定 undefined 报 parameter 6
s = s.replace(/ensureAnchor\(db, qq, "person"\)/g, 'ensureAnchor(db, qq, "person", Date.now())');

if (s === before) {
  const line = s.split("\n").find((l) => l.includes("ensureAnchor"));
  console.log("没匹配，实际那行：" + String(line).trim());
} else {
  writeFileSync(p, s, "utf8");
  console.log("已补 nowTs 参数");
}
