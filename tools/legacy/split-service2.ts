import { readFileSync, writeFileSync } from "node:fs";

/**
 * 修第二轮：注释把后面的代码吃进去了。
 *
 * 一行化之后形如：
 *   // 它自己判断某件事值得记，就直接存          save: (text) => {
 * 原始换行位置就是「两个以上空格 + 标识符 + :/(=/=」之前。
 * 在这里断开，注释归注释，代码归代码。
 */
let text = readFileSync("src/bot/service.fixed.ts", "utf8");
const lines = text.split("\n");
let fixed = 0;

const CODE_START = /(\s{2,})(?=(?:[a-zA-Z_$][\w$]*\s*[:(=]|[}\])]|return\b|const\b|if\s*\(|for\s*\(|try\b|this\.|await\b|import\b|export\b|private\b|public\b|async\b))/;

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i]!;
  const at = line.indexOf("//");
  if (at < 0) continue;

  const rest = line.slice(at + 2);
  const m = CODE_START.exec(rest);
  if (!m) continue;

  const cut = at + 2 + m.index + m[1]!.length;
  const comment = line.slice(0, cut).replace(/\s+$/, "");
  const code = line.slice(cut);
  if (code.trim().length === 0) continue;
  lines[i] = `${comment}\n${code}`;
  fixed += 1;
}

writeFileSync("src/bot/service.fixed.ts", lines.join("\n"), "utf8");
console.log(`修了 ${fixed} 处被注释吃掉的代码`);
