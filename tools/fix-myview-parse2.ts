import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract.ts";
const lines = readFileSync(p, "utf8").split("\n");

// 第 317 行（索引 316）：把 detail 换成带 my_view 的写法
const idx = 316;
if (!lines[idx]?.includes("detail: str(d.detail, 400),")) {
  console.log("行号对不上，当前是：" + (lines[idx] ?? "").trim());
  process.exit(1);
}

lines[idx] = [
  "        detail: (() => {",
  "          const base = str(d.detail, 400).replace(/主人/g, names.user);",
  '          const rawView = String((d as { my_view?: unknown }).my_view ?? "").trim();',
  '          if (!rawView || rawView === "null" || rawView === "无") return base;',
  "          const view = rawView.replace(/主人/g, names.user).slice(0, 120);",
  "          return `${base}〔我当时想：${view}〕`;",
  "        })(),",
].join("\n");

writeFileSync(p, lines.join("\n"), "utf8");
console.log("已替换第 317 行");
