import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract.ts";
const lines = readFileSync(p, "utf8").split("\n");

// 第 266 行（索引 265）：const list = parseLoose(raw);
if (!lines[265]?.includes("const list = parseLoose(raw);")) {
  console.log("行号对不上：" + (lines[265] ?? "").trim());
  process.exit(1);
}

lines[265] = [
  "  // 模型有时会包 ```json ... ``` 或前后带解释文字。",
  "  // 不处理的话，整批记忆会因为一个代码块标记全丢掉——温度 0.3 下时好时坏，最难查。",
  "  const cleaned = (() => {",
  '    const t = String(raw ?? "").trim();',
  '    const fenced = t.match(/```(?:json)?\\s*([\\s\\S]*?)```/);',
  "    if (fenced && fenced[1]) return fenced[1].trim();",
  '    const firstBracket = t.indexOf("[");',
  '    const firstBrace = t.indexOf("{");',
  "    const start =",
  "      firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace) ? firstBracket : firstBrace;",
  '    const end = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));',
  "    if (start >= 0 && end > start) return t.slice(start, end + 1);",
  "    return t;",
  "  })();",
  "",
  "  const list = parseLoose(cleaned);",
].join("\n");

writeFileSync(p, lines.join("\n"), "utf8");
console.log("解析前已加清洗");
