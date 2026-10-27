import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract-v3.ts";
let s = readFileSync(p, "utf8");
const before = s;

// linkEventAnchor 只有 4 个参数，把多加的去掉
s = s.replace(/linkEventAnchor\(db, row\.id, a\.id, 1\.0, "mentioned", Date\.now\(\)\)/g, "linkEventAnchor(db, row.id, a.id, 1.0)");
s = s.replace(/linkEventAnchor\(db, row\.id, scene, 0\.5, "subject", Date\.now\(\)\)/g, "linkEventAnchor(db, row.id, scene, 0.5)");
// 之前还有一处 5 参数的写法
s = s.replace(/linkEventAnchor\(db, row\.id, a\.id, 1\.0, "mentioned"\)/g, "linkEventAnchor(db, row.id, a.id, 1.0)");
s = s.replace(/linkEventAnchor\(db, row\.id, scene, 0\.5, "subject"\)/g, "linkEventAnchor(db, row.id, scene, 0.5)");

if (s === before) {
  for (const l of s.split("\n").filter((x) => x.includes("linkEventAnchor"))) console.log("实际：" + l.trim());
} else {
  writeFileSync(p, s, "utf8");
  console.log("已修正 linkEventAnchor 参数");
}
