import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 她自己写的抽取规则。
 *
 * 代码里的规则是底线（结构、格式、人称），不能让她改坏。
 * 但「抽出来的东西该有什么分量」「我的判断怎么写」这类，她比代码作者更清楚——
 * 所以给她一个文件，写什么都行，会原样追加到抽取提示词末尾。
 *
 * 文件一变，抽取缓存自动失效（见 extract.ts 里的 sig）。
 */
export function rulesPath(dataDir: string): string {
  return join(dataDir, "extract-rules.md");
}

export function loadExtractRules(dataDir: string): string {
  try {
    const f = rulesPath(dataDir);
    if (!existsSync(f)) return "";
    return readFileSync(f, "utf8").trim();
  } catch {
    return "";
  }
}

export function saveExtractRules(dataDir: string, text: string): string {
  const f = rulesPath(dataDir);
  mkdirSync(join(dataDir), { recursive: true });
  const body = String(text ?? "").trim();
  writeFileSync(f, body.length > 0 ? `${body}\n` : "", "utf8");
  return body;
}

/** 用规则内容的短哈希做版本号：改了规则，缓存自然作废 */
export function rulesVersion(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}
