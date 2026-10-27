import { readFileSync, writeFileSync } from "node:fs";

const p = "src/bot/service.ts";
const lines = readFileSync(p, "utf8").split("\n");

// 把插错位置的 import 删掉
const importLine = 'import { resolveSaidBy } from "../learn-person.ts";';
let removed = 0;
for (let i = lines.length - 1; i >= 0; i -= 1) {
  if (lines[i]!.trim() === importLine) {
    lines.splice(i, 1);
    removed += 1;
  }
}

// 插到第一段 import 完整结束之后（含 node:sqlite 那一行）
const anchor = lines.findIndex((l) => l.includes('from "node:sqlite"'));
if (anchor < 0) {
  console.log("找不到 node:sqlite import");
  process.exit(1);
}
lines.splice(anchor + 1, 0, importLine);

writeFileSync(p, lines.join("\n"), "utf8");
console.log(`删掉错位的 ${removed} 处，插到第 ${anchor + 2} 行`);
