import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract.ts";
const lines = readFileSync(p, "utf8").split("\n");

const i = lines.findIndex((l) => l.includes('return `${EXTRACT_VERSION}:${sigBase}`;'));
if (i < 0) {
  console.log("没找到版本号那行");
  process.exit(1);
}

if (lines[i + 1]?.includes('return `${turns.length}:${total}:${head}~${tail}`;')) {
  lines.splice(i + 1, 1);
  writeFileSync(p, lines.join("\n"), "utf8");
  console.log("已删掉那行无用 return");
} else {
  console.log("下一行不是它：" + (lines[i + 1] ?? "").trim());
}
