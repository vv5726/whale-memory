import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 一张图，要出两层东西：
 *
 *   ① 事实层：谁发的、图里到底是什么（本地千问看，客观描述）
 *   ② 意思层：发这张图可能是想表达什么（DeepSeek 想，允许推测）
 *
 * 为什么分两层：
 *   混成一句，要么把猜测写成事实（以后就当真的了），
 *   要么只记事实，永远读不懂表情包。
 */
interface BotCfg {
  deepseekBaseUrl?: string;
  deepseekApiKey?: string;
  deepseekModel?: string;
}

function loadCfg(dataDir: string): BotCfg {
  try {
    const f = join(dataDir, "bot.json");
    if (!existsSync(f)) return {};
    return JSON.parse(readFileSync(f, "utf8")) as BotCfg;
  } catch {
    return {};
  }
}

/**
 * 第二层：这张图可能是啥意思。
 *
 * 输入只有「描述」和「最近几句话」——不看原图，故意的：
 * 看图是事实，读意思是理解，两件事不该由同一个判断做。
 */
export async function interpretImage(
  dataDir: string,
  description: string,
  context: string,
): Promise<string> {
  const cfg = loadCfg(dataDir);
  const base = cfg.deepseekBaseUrl ?? "https://api.deepseek.com/v1";
  const key = cfg.deepseekApiKey ?? "";
  const model = cfg.deepseekModel ?? "deepseek-chat";
  if (key.length === 0) return "";

  const prompt = [
    "有人在聊天里发了一张图。",
    "",
    `图里的内容：${description}`,
    context ? `刚才在聊：${context}` : "",
    "",
    "他发这张图，可能是想表达什么？一句话，别超过二十五个字。",
    "如果是表情包，说它大概的情绪或态度（比如「有点无语」「在敷衍我」「认同但懒得说」）。",
    "拿不准就写「看不出发什么」，别硬编。",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
        max_tokens: 80,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return "";
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return String(json.choices?.[0]?.message?.content ?? "").trim();
  } catch {
    return "";
  }
}
