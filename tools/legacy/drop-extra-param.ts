import { readFileSync, writeFileSync } from "node:fs";

const p = "src/notes.ts";
const lines = readFileSync(p, "utf8").split("\n");

// 第一处 run 末尾多了一个 ""，删掉（还原成 28 参数对应 28 占位符）
const i = lines.findIndex((l, idx) => l.trim() === '""' && lines[idx + 1]?.trim() === ");");
if (i >= 0) {
  lines.splice(i, 1);
  writeFileSync(p, lines.join("\n"), "utf8");
  console.log(`删掉多余参数（行 ${i + 1}）`);
} else {
  console.log("没找到多余参数");
}
