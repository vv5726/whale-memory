import { readFileSync, writeFileSync } from "node:fs";

/**
 * 从压平的原文件重建换行。
 *
 * 上次错在：遇到 } 就断行，但 } 可能是表达式的一部分（rowToEvent(r))）。
 *
 * 这次只用两条**天然安全**的规则：
 *   ① 在 ; 和 { 之后断行 —— 这两个位置在合法代码里永远可以换行
 *      （; 是语句结束；{ 是块/对象字面量开头，后面换行永远合法）
 *   ② 遇到 // 时，找出注释真正结束的位置：注释是中文散文，
 *      后面紧跟的代码通常是「2+ 空格 + 标识符 + : ( =」或关键字
 *   ③ 绝不在 } 后断行
 *
 * 字符串、模板串、正则都靠扫描器跳过，不会误切。
 */
const src = readFileSync("data/service.flat.122518.bak", "utf8");

let out = "";
let quote: string | null = null;
let inRegex = false;
let i = 0;
let prevSignificant = "";

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

  if (inRegex) {
    out += ch;
    if (ch === "\\") {
      out += src[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (ch === "/") inRegex = false;
    i += 1;
    continue;
  }

  if (ch === '"' || ch === "'" || ch === "`") {
    quote = ch;
    out += ch;
    i += 1;
    continue;
  }

  // 正则字面量：/ 前面是 ( , = : [ ! & | ? { return 之类
  if (ch === "/" && src[i + 1] !== "/" && src[i + 1] !== "*") {
    if (/[(,=:[!&|?{};]|return|typeof/.test(prevSignificant)) {
      inRegex = true;
      out += ch;
      i += 1;
      continue;
    }
  }

  // 行注释：找出它真正的结尾
  if (ch === "/" && src[i + 1] === "/") {
    let j = i + 2;
    // 注释里偶尔有 // 之外的路径，扫到「2+ 空格 + 代码起点」为止
    const CODE = /\s{2,}(?=(?:[a-zA-Z_$][\w$]*\s*[:(=]|[}\])]|return\b|const\b|let\b|if\s*\(|for\s*\(|while\s*\(|try\b|this\.|await\b|import\b|export\b|private\b|public\b|async\b|new\b|throw\b|switch\b))/g;
    const rest = src.slice(j);
    const m = CODE.exec(rest);
    j = m ? j + m.index : src.length;
    out += src.slice(i, j).replace(/\s+$/, "") + "\n";
    i = j;
    continue;
  }

  out += ch;
  if (ch === ";" || ch === "{") out += "\n";
  if (!/\s/.test(ch)) prevSignificant = ch;
  i += 1;
}

out = out
  .split("\n")
  .map((l) => l.replace(/\s+$/, ""))
  .filter((l, idx, arr) => !(l.length === 0 && arr[idx - 1] === ""))
  .join("\n");

writeFileSync("src/bot/service.recover.ts", out, "utf8");
console.log(`重建 ${out.split("\n").length} 行 → src/bot/service.recover.ts`);
