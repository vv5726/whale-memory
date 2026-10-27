import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract-v3.ts";
let s = readFileSync(p, "utf8");
const before = s;

// linkEventAnchor 也要 nowTs（最后一个参数）
s = s.replace(/linkEventAnchor\(db, row\.id, a\.id, 1\.0, "mentioned"\)/g, 'linkEventAnchor(db, row.id, a.id, 1.0, "mentioned", Date.now())');
s = s.replace(/linkEventAnchor\(db, row\.id, scene, 0\.5, "subject"\)/g, 'linkEventAnchor(db, row.id, scene, 0.5, "subject", Date.now())');

if (s === before) {
  for (const l of s.split("\n").filter((x) => x.includes("linkEventAnchor"))) console.log("实际：" + l.trim());
} else {
  writeFileSync(p, s, "utf8");
  console.log("已补 linkEventAnchor 的时间参数");
}
