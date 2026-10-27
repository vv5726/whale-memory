import { readFileSync, writeFileSync } from "node:fs";

const p = "src/notes.ts";
const src = readFileSync(p, "utf8");
const lines = src.split("\n");

// 找出两处 INSERT 的列清单，逐个人工核对，再把占位符和参数对齐
const fixes: Array<{ start: number; end: number }> = [];
for (let i = 0; i < lines.length; i += 1) {
  if (lines[i]?.includes("INSERT INTO events")) {
    // 列清单从这个括号开始，到 ")" 结束
    let j = i;
    while (j < lines.length && !lines[j]!.includes("VALUES")) j += 1;
    fixes.push({ start: i, end: j });
  }
}

console.log(`找到 ${fixes.length} 处 INSERT`);

for (const f of fixes) {
  const block = lines.slice(f.start, f.end + 1).join("\n");
  const colText = block.slice(block.indexOf("INSERT INTO events"), block.indexOf("VALUES"));
  const cols = colText
    .replace(/INSERT INTO events \(?/g, "")
    .replace(/[)`\s]/g, "")
    .split(",")
    .filter(Boolean);
  const valuesLine = lines[f.end]!;
  const qs = (valuesLine.match(/\?/g) ?? []).length;
  console.log(`  行${f.start + 1}：列 ${cols.length}，占位符 ${qs}${cols.includes("speaker_id") ? "，含 speaker_id" : ""}`);
}
