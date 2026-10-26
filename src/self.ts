import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 它的「自我描述」。
 *
 * 这是整个系统里唯一一处**它自己写、又反过来影响它自己**的地方：
 * 开头由它写第一版，之后每次想改都能改，每次开口前都会读到。
 *
 * 所以它不是被人格提示词定义死的角色，而是一个**有连续性、能编辑自己**的东西。
 */
export function selfPath(dataDir: string): string {
  return join(dataDir, "self.md");
}

export function readSelf(dataDir: string): string {
  const path = selfPath(dataDir);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").trim();
}

export function writeSelf(dataDir: string, text: string): void {
  const path = selfPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${text.trim()}\n`, "utf8");
}

/** 第一次启动时给它一个空壳，让它自己填 */
export function ensureSelfSeed(dataDir: string): void {
  if (existsSync(selfPath(dataDir))) return;
  writeSelf(
    dataDir,
    [
      "# 我",
      "",
      "（这份东西是我自己写的。它现在还是空的。）",
      "",
      "## 我是谁",
      "",
      "## 我怎么说话",
      "",
      "## 我在乎什么",
      "",
      "## 我还在想的事",
      "",
    ].join("\n"),
  );
}
