import { readFileSync, writeFileSync } from "node:fs";

const p = "src/bot/autonomy.ts";
let s = readFileSync(p, "utf8");

const oldBlock = [
  "        // 简报里每一条「读过的」，都单独落一条记忆——读过的必须记得住",
  '        for (const line of report.summary.split("\\n")) {',
  "          const m = /^【读了】\\s*(.+)$/.exec(line.trim());",
  "          if (m) this.service.recordNote(`读到的：${m[1]!.trim()}`);",
  "        }",
].join("\n");

const newBlock = [
  "        // 简报里每一条「读过的」，都单独落一条记忆——读过的必须记得住",
  "        for (const item of parseReadItems(report.summary)) {",
  "          this.service.recordNote(`读到的：${item}`);",
  "        }",
].join("\n");

if (s.includes(oldBlock)) {
  s = s.replace(oldBlock, newBlock);
} else {
  console.log("旧的解析块没找到，跳过替换");
}

// 追加解析函数
if (!s.includes("function parseReadItems")) {
  const fn = [
    "",
    "/**",
    " * 从阅读员的简报里抽出「读过的条目」。",
    " *",
    " * 它可能写成一行一条，也可能写成【读了】小标题 + 多行列表——两种都要认，",
    " * 否则读过的东西一条都进不了记忆。",
    " */",
    "export function parseReadItems(summary: string): string[] {",
    "  const items: string[] = [];",
    "  const lines = summary.split(/\\r?\\n/);",
    "  let inSection = false;",
    "",
    "  for (const raw of lines) {",
    "    const line = raw.trim();",
    "    if (line.length === 0) continue;",
    "",
    "    const header = /^【(.+?)】\\s*(.*)$/.exec(line);",
    "    if (header) {",
    '      inSection = header[1]!.includes("读了") || header[1]!.includes("值得");',
    '      const rest = (header[2] ?? "").trim();',
    "      if (inSection && rest.length > 0) items.push(rest);",
    "      continue;",
    "    }",
    "",
    "    if (inSection) items.push(line);",
    "  }",
    "",
    "  return items.slice(0, 10);",
    "}",
  ].join("\n");
  s = s + fn;
}

writeFileSync(p, s, "utf8");
console.log("解析器已更新");
