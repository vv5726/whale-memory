import { readFileSync, writeFileSync } from "node:fs";

/**
 * 把压成一行的文件重新拆行。
 *
 * 只做一件事：在字符串**外面**的 ; { } 之后插换行。
 * 不动任何字节内容，所以注释和代码都在，只是重新分行。
 * 副作用：// 注释会吃到它所在的那一小段末尾——后面单独修。
 */
const src = readFileSync("src/bot/service.ts", "utf8");

let out = "";
let quote: string | null = null;
let i = 0;

while (i < src.length) {
  const ch = src[i]!;

  if (quote) {
    out += ch;
    if (ch === "\\") {
      out += src[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (ch === quote) quote = null;
    i += 1;
    continue;
  }

  // 进入字符串
  if (ch === '"' || ch === "'" || ch === "`") {
    quote = ch;
    out += ch;
    i += 1;
    continue;
  }

  // 行注释：整段原样保留，直到遇见 ; { } —— 那基本就是它原来的结尾附近
  if (ch === "/" && src[i + 1] === "/") {
    let j = i;
    while (j < src.length && !";{}".includes(src[j]!)) j += 1;
    out += src.slice(i, j) + "\n";
    i = j;
    continue;
  }

  out += ch;
  if (ch === ";" || ch === "{" || ch === "}") out += "\n";
  i += 1;
}

// 收尾：多余空行压掉
out = out
  .split("\n")
  .map((l) => l.replace(/\s+$/, ""))
  .filter((l, idx, arr) => !(l.length === 0 && arr[idx - 1] === ""))
  .join("\n");

writeFileSync("src/bot/service.fixed.ts", out, "utf8");

const lines = out.split("\n").length;
console.log(`拆出 ${lines} 行，写入 src/bot/service.fixed.ts`);
