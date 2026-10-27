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
      const hasMessage = typeof obj["消息"] === "string" ? String(obj["消息"]).trim().length > 0 : typeof obj.message === "string" && obj.message.trim().length > 0;
      const channel =
        channelRaw.includes("聊天") || channelRaw === "chat"
          ? "chat"
          : channelRaw.includes("内容") || channelRaw === "content"
            ? "content"
            : channelRaw.includes("做") || channelRaw === "act"
              ? "act"
              : channelRaw.length === 0 && hasMessage
                ? "chat" // 只给了消息没给途径：当成要说话
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
  // 2026-10-27 放宽：她常写成「找人聊天」「聊天（私聊）」「找 他 聊天」，
  // 以前只认冒号后面紧跟「聊天/内容/做/算了」，这些写法一律被解析成 none，
  // 想说话的那次就被记成「没什么要做的」，白白吞掉。
  // 注意：标签后面的空白只能用 [ \t]*，不能用 \s*——
  // 「消息：\n给：他」这种空消息会被 \s* 吃掉换行，然后把「给：他」当成消息内容发出去。
  const channelLine = /途径[：:][ \t]*([^\n]*)/.exec(text);
  const goalLine = /目的[：:][ \t]*(.+)/.exec(text);
  const toLine = /给[：:][ \t]*([^\n]+)/.exec(text);
  const messageLine = /消息[：:][ \t]*([\s\S]*?)(?=\n[ \t]*给[：:]|\n[ \t]*目的[：:]|\n[ \t]*途径[：:]|$)/.exec(text);

  const channelRaw = (channelLine?.[1] ?? "").trim();
  let channel: Intent["channel"];
  if (/算了|不做|什么都不|没什么|^无$|^空$|none/i.test(channelRaw)) {
    channel = "none";
  } else if (/聊天|私聊|群聊|找他|找她|跟?他说|说话|发消息|问一下|问问/.test(channelRaw)) {
    channel = "chat";
  } else if (/内容|视频|哔哩|b\s*站|刷/.test(channelRaw)) {
    channel = "content";
  } else if (/做|动手|工具|手机|整理|记下|笔记|写/.test(channelRaw)) {
    channel = "act";
  } else if (channelRaw.length === 0 && /消息[：:]/.test(text)) {
    // 没写途径但写了消息：当成"要说话"
    channel = "chat";
  } else {
    channel = "none";
  }

  const messageFromLine = (messageLine?.[1] ?? "").trim();
  return {
    goal: (goalLine?.[1] ?? "").slice(0, 60),
    channel,
    to: toLine?.[1]?.trim().slice(0, 40),
    message:
      channel === "chat"
        ? (messageFromLine.length > 0
            ? messageFromLine
            : text
                .replace(/目的[：:].+|途径[：:].+|给[：:].+/g, "")
                .replace(/^\s*消息[：:]\s*/, "")
                .trim()
          ).slice(0, 800)
        : undefined,
  };
}
