import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 读心：回话之前，先弄清三件事。
 *
 *   ① 他这句话表面上在说什么
 *   ② 他的情绪 / 心情是什么（从措辞、标点、表情、长短判断）
 *   ③ 我听完是什么反应（不是「该怎么回」，是真实反应）
 *
 * 为什么单独一步：主模型一边分析一边回话，容易两件都做不好；
 * 而把它做成「必须填的字段」，它就会照着格式编一个。
 * 所以这一步算出来的东西，只是作为背景塞回主提示词——它不用再分析，只用说话。
 */
export interface MindRead {
  surface: string;
  emotion: string;
  myReaction: string;
}

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

export async function readMind(
  dataDir: string,
  message: string,
  history: Array<{ role: string; text: string }> = [],
): Promise<MindRead | null> {
  const cfg = loadCfg(dataDir);
  const base = cfg.deepseekBaseUrl ?? "https://api.deepseek.com/v1";
  const key = cfg.deepseekApiKey ?? "";
  const model = cfg.deepseekModel ?? "deepseek-chat";
  if (key.length === 0 || message.trim().length === 0) return null;

  const recent = history
    .slice(-6)
    .map((h) => `${h.role === "user" ? "他" : "我"}：${String(h.text).replace(/\s+/g, " ").slice(0, 60)}`)
    .join("\n");

  const prompt = [
    "下面是对方刚说的一句话，以及前面几句对话。",
    recent ? `\n前面几句：\n${recent}\n` : "",
    `他刚说：「${message.slice(0, 200)}」`,
    "",
    "判断三件事，只输出 JSON：",
    '{"surface":"他表面上在说什么（15字内）",',
    ' "emotion":"他的情绪或心情，要具体（从措辞/标点/表情看出来），20字内",',
    ' "my_reaction":"我听完这句话的第一反应（认同/被刺到/无所谓/想反驳/心里一沉…），20字内"}',
    "",
    "要求：",
    "- 不要写「该怎么回」，只写真实反应。",
    "- 判断不出来就写「猜不出」，别硬编。",
    "- 不要客套，不要分析自己。",
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
        temperature: 0.3,
        max_tokens: 160,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = String(json.choices?.[0]?.message?.content ?? "");
    const m = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
    const body = m?.[1] ?? raw;
    const a = body.indexOf("{");
    const b = body.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    const parsed = JSON.parse(body.slice(a, b + 1)) as Partial<MindRead>;
    const surface = String(parsed.surface ?? "").trim();
    const emotion = String(parsed.emotion ?? "").trim();
    const myReaction = String(parsed.my_reaction ?? "").trim();
    if (surface.length === 0 && emotion.length === 0) return null;
    return { surface, emotion, myReaction };
  } catch {
    return null;
  }
}
