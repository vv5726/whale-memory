/**
 * 逐个 INSERT 核对：列数 / 占位符数 / 参数个数。
 * 不猜，只数。
 */
import { readFileSync } from "node:fs";

const files = ["src/extract.ts", "src/notes.ts", "src/about-person.ts", "src/llm/extract.ts"];

const countTopLevelCommas = (text: string): number => {
  let depth = 0;
  let count = 0;
  let inStr: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inStr) {
      if (ch === "\\") i += 1;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) count += 1;
  }
  return count;
};

for (const f of files) {
  let src: string;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }

  let idx = 0;
  while (true) {
    const at = src.indexOf("INSERT INTO events", idx);
    if (at < 0) break;
    idx = at + 10;

    // 列清单：从 INSERT 后第一个 ( 到匹配的 )
    const open = src.indexOf("(", at);
    let depth = 0;
    let close = -1;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    const colText = src.slice(open + 1, close);
    const cols = colText.split(",").map((c) => c.trim()).filter(Boolean).length;

    // 占位符
    const valuesAt = src.indexOf("VALUES", close);
    const stmtEnd = src.indexOf("`", valuesAt);
    const valuesText = src.slice(valuesAt, stmtEnd);
    const holes = (valuesText.match(/\?/g) ?? []).length;

    // 参数：找 .run( 的配对括号
    const runAt = src.indexOf(".run(", stmtEnd);
    const arrOpen = src.indexOf("(", runAt);
    depth = 0;
    let arrClose = -1;
    for (let i = arrOpen; i < src.length; i += 1) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          arrClose = i;
          break;
        }
      }
    }
    const argsText = src.slice(arrOpen + 1, arrClose).trim().replace(/,$/, "");
    const args = argsText.length === 0 ? 0 : countTopLevelCommas(argsText) + 1;

    const line = src.slice(0, at).split("\n").length;
    const ok = cols === holes && holes === args ? "✓" : "✗";
    console.log(`${ok} ${f}:${line}  列 ${cols} ｜ 占位符 ${holes} ｜ 参数 ${args}${cols !== args ? "   ← 对不上" : ""}`);
  }
}
