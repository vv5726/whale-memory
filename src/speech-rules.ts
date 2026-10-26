import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 她自己写的「怎么说话」。
 *
 * 代码里的【怎么说话】是底线（别演客服、别复述），
 * 但「我该更软一点 / 别拿工具返回值当回话 / 群里一句半」这类，她自己最清楚。
 *
 * 文件一变，下一次对话立刻生效（每轮都读，不缓存——就一个小文件）。
 */
export function speechRulesPath(dataDir: string): string {
  return join(dataDir, "speech-rules.md");
}

export function loadSpeechRules(dataDir: string): string {
  try {
    const f = speechRulesPath(dataDir);
    if (!existsSync(f)) return "";
    return readFileSync(f, "utf8").trim();
  } catch {
    return "";
  }
}

export function saveSpeechRules(dataDir: string, text: string): string {
  const body = String(text ?? "").trim();
  writeFileSync(speechRulesPath(dataDir), body.length > 0 ? `${body}\n` : "", "utf8");
  return body;
}
