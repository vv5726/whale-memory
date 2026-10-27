import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LlmAdapter } from "../llm/adapter.ts";

const AVATAR_EXT = /\.(png|jpe?g|webp|gif)$/i;

export interface IdentityChoice {
  name: string | null;
  avatarFile: string | null;
  reason: string;
}

/** 列出可用的头像文件（放在 data/avatars/ 里） */
export function listAvatars(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => AVATAR_EXT.test(f));
}

/**
 * 让它自己挑名字和头像。
 *
 * 为什么不自动定时改名：改名是**对外的、别人能看见的**动作，
 * 偶尔一次是惊喜，天天改就是骚扰。所以做成手动触发，你按一下它才想。
 */
export async function chooseIdentity(
  adapter: LlmAdapter,
  input: { currentName: string; avatars: string[]; recentChat?: string },
): Promise<IdentityChoice> {
  const avatarList =
    input.avatars.length > 0
      ? input.avatars.map((f, i) => `${i + 1}. ${f}`).join("\n")
      : "（没有可用头像）";

  const messages = [
    {
      role: "system" as const,
      content: [
        "你叫「凝」，在 QQ 上跟一个人聊天。现在给你一次机会：决定要不要换个名字、换个头像。",
        "只输出 JSON，不要解释：",
        '{"name":"想用的新名字（不换就填 null）","avatar":序号或null,"reason":"一句话说为什么"}',
        "",
        "规则：",
        "- 名字两个字以内，不要用英文，不要带符号。",
        "- 如果你觉得「凝」就挺好，name 填 null —— 不换也是个决定。",
        "- 头像从下面这份名单里挑一个序号：",
        avatarList,
        "- reason 用第一人称说一句，二十字以内。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `我现在的名字是「${input.currentName}」。`,
        input.recentChat ? `我们最近聊过：${input.recentChat.slice(0, 200)}` : "",
        "你想叫什么？想用哪个头像？",
      ]
        .filter((s) => s.length > 0)
        .join("\n"),
    },
  ];

  const raw = await adapter.complete(messages, { json: true, timeoutMs: 60_000 });
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim();
  let parsed: { name?: unknown; avatar?: unknown; reason?: unknown } = {};
  try {
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return { name: null, avatarFile: null, reason: "（模型没给出可解析的答案）" };
  }

  const rawName = typeof parsed.name === "string" ? parsed.name.trim() : "";
  // 名字要清爽：两字以内、纯中文
  const name = /^[\u4e00-\u9fa5]{1,2}$/.test(rawName) ? rawName : null;

  const idx = Number(parsed.avatar);
  const avatarFile =
    Number.isInteger(idx) && idx >= 1 && idx <= input.avatars.length ? input.avatars[idx - 1] : null;

  const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 40) : "";
  return { name, avatarFile, reason };
}

export function avatarPath(dir: string, file: string): string {
  return join(dir, file);
}
