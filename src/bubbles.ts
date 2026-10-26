/**
 * 把一段话拆成几条短消息发。
 *
 * 为什么要拆：一次扔一整段，读起来像邮件；拆成两三条、中间停一下，
 * 才像人在打字。这是「像不像在聊天」最直观的差别，跟人格无关。
 */

/** 按句末标点切句，但保留标点 */
function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[。！？!?…～~])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [text.trim()];
}

/**
 * 拆气泡。
 *
 * 规则：
 *  - 很短（≤28 字）就一条，别硬拆
 *  - 最多 3 条，太多像刷屏
 *  - 单条超过 45 字就留在原句里，不硬切
 */
export function toBubbles(text: string): string[] {
  // 按它自己写的换行拆——分几条、在哪儿断，由它决定，不再按句号切
  const clean = String(text ?? "").trim();
  if (clean.length === 0) return [];
  const parts = clean
    .split(/\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  return parts.length > 0 ? parts : [clean];
}

/** 按它自己写的换行拆（不再按句号） */

export function bubbleDelay(prev: string): number {
  const base = 450 + Math.min(1200, prev.length * 22);
  return Math.round(base + Math.random() * 350);
}
