/**
 * 目标 + 途径。
 *
 * 一次行动不是「随便干点什么」，而是：
 *   我到底想达到什么（目的）→ 用什么办法（途径）
 * 途径只有三条：
 *   content  去刷内容（B站 / 抖音）——为了知道点什么
 *   chat     找人说话——为了问他、或者告诉他
 *   act      用手机做一件具体的事（看界面、截图、开某个 App）
 * 想不出来就 none，什么都不做。
 *
 * 这个结构是给模型看的，所以字段名用中文，减少它抄错的概率。
 */
export interface Intent {
  goal: string;
  channel: "content" | "chat" | "act" | "none";
  /** 如果是 chat，就是要发出去的话 */
  message?: string;
  /** 如果是 act，就是要做的那件事 */
  action?: string;
  /** 可选：这句话说给谁（名字 / QQ 号 / 群号 / 「群里」） */
  to?: string;
}

export function parseIntent(raw: string): Intent {
  const fallback: Intent = { goal: "", channel: "none" };
  const text = raw.trim();
  if (text.length === 0) return fallback;

  // 先尝试当 JSON 解析
  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const channelRaw = String(obj["途径"] ?? obj.channel ?? "").trim();
      const channel =
        channelRaw.includes("聊天") || channelRaw === "chat"
          ? "chat"
          : channelRaw.includes("内容") || channelRaw === "content"
            ? "content"
            : channelRaw.includes("做") || channelRaw === "act"
              ? "act"
              : "none";
      return {
        goal: String(obj["目的"] ?? obj.goal ?? "").slice(0, 60),
        channel,
        message: typeof obj["消息"] === "string" ? obj["消息"] : typeof obj.message === "string" ? obj.message : undefined,
        to: typeof obj["给"] === "string" ? obj["给"] : typeof obj.to === "string" ? obj.to : undefined,
        action: typeof obj["动作"] === "string" ? obj["动作"] : typeof obj.action === "string" ? obj.action : undefined,
      };
    } catch {
      // 落到下面的文本解析
    }
  }

  // 纯文本兜底：找「途径：xxx」
  const channelLine = /途径[：:]\s*(内容|聊天|做|算了|none|content|chat|act)/.exec(text);
  const goalLine = /目的[：:]\s*(.+)/.exec(text);
  const toLine = /给[：:]\s*(.+)/.exec(text);
  const channel = channelLine
    ? channelLine[1]!.includes("聊天")
      ? "chat"
      : channelLine[1]!.includes("内容")
        ? "content"
        : channelLine[1]!.includes("做")
          ? "act"
          : "none"
    : "none";

  return {
    goal: (goalLine?.[1] ?? "").slice(0, 60),
    channel,
    to: toLine?.[1]?.trim().slice(0, 40),
    message:
      channel === "chat"
        ? text
            .replace(/目的[：:].+|途径[：:].+|给[：:].+/g, "")
            .replace(/^\s*消息[：:]\s*/, "")
            .trim()
            .slice(0, 800)
        : undefined,
  };
}
