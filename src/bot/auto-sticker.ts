import { getSticker, loadIndex } from "../stickers.ts";

/**
 * 回复之后「顺手配一张图」的兜底。
 *
 * 为什么需要：提示词里写了「想发就发」，但模型几乎从不主动调——
 * 它更愿意多写两句字。光靠它自己想不起来，所以这里按情绪关键词兜一层：
 * 回复里出现笑/无语/委屈…就顺手配一张，概率 30%，不满足条件不发。
 *
 * 三条硬约束（都在 stickers.ts 里）：
 *  - 每小时最多 6 张、同一张 30 分钟冷却 → 不会刷屏
 *  - 只用库里已有的图（allowSearch:false），不现场搜、不加延迟
 *  - 找不到合适的就什么都不做
 */

/** 回复里的情绪词 → 图库里的 query */
const RULES: Array<{ re: RegExp; query: string }> = [
  { re: /哈哈|笑死|好笑|乐死|嘿嘿|绷不住/, query: "大肥鱼开心" },
  { re: /无语|服了|离谱|什么啊|离谱|这也行/, query: "大肥鱼疑惑" },
  { re: /委屈|难过|伤心|呜呜|唉…|心酸/, query: "大肥鱼难过" },
  { re: /生气|气死|烦死|讨厌/, query: "大肥鱼生气" },
  { re: /害羞|脸红|别夸|讨厌啦/, query: "大肥鱼害羞" },
  { re: /叹气|唉$|算了/, query: "大肥鱼叹气" },
  { re: /困了|睡觉|晚安|睡了/, query: "大肥鱼睡觉" },
  { re: /加班|干活|忙死|写代码|debug/i, query: "大肥鱼加班" },
  { re: /震惊|真的假的|啊？|不会吧/, query: "大肥鱼震惊" },
  { re: /喜欢|贴贴|抱抱|想你/, query: "大肥鱼喜欢" },
];

/** 这条回复适合配什么图（没有就返回 null） */
export function autoStickerQuery(reply: string): string | null {
  const text = String(reply ?? "");
  if (text.trim().length < 2) return null;
  for (const r of RULES) if (r.re.test(text)) return r.query;
  return null;
}

export interface AutoStickerResult {
  sent: boolean;
  reason: string;
  file?: string;
}

/**
 * 按概率顺手发一张。chance 默认 0.3（三成，别每句都配）。
 * force=true 时不掷骰子（测试用）。
 */
export async function autoStickerAfterReply(
  dataDir: string,
  reply: string,
  opts: { chance?: number; force?: boolean; send?: (file: string) => void | Promise<void> } = {},
): Promise<AutoStickerResult> {
  const query = autoStickerQuery(reply);
  if (!query) return { sent: false, reason: "这段话不适合配图" };
  if (!opts.send) return { sent: false, reason: "没有发送通道" };
  const chance = opts.chance ?? 0.3;
  if (!opts.force && Math.random() >= chance) return { sent: false, reason: "这次没掷中" };

  // 库里得有货才发，避免每次去搜（拖慢回复）
  const has = loadIndex(dataDir).items.some((x) => x.query.includes(query));
  if (!has) return { sent: false, reason: `库里没有「${query}」` };

  const got = await getSticker(dataDir, { query, allowSearch: false });
  if (!got.ok || !got.file) return { sent: false, reason: got.text };
  await opts.send(got.file);
  return { sent: true, reason: `配了一张「${query}」`, file: got.file };
}
