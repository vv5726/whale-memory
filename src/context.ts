import type { DatabaseSync } from "node:sqlite";
import type { AnchorKind } from "./types.ts";
import { matchAnchors, type AnchorIndex } from "./anchors.ts";
import type { AnchorProposal } from "./propose.ts";

/**
 * 写入时检索：在「读这句话」之前，先把它的处境从记忆里拉出来。
 *
 * 单看「它一直没叫」没有情绪。要先知道「它在宠物医院」「这是只平时会叫的猫」，
 * 才读得出「忍着不叫，让人心疼」。情绪不在句子里，在处境里。
 *
 * 这也是治「该记的被丢」的办法：「走廊上那股消毒水味到现在还记得」单独看是 0 分，
 * 一旦知道背景是「我妈住院三天」，它立刻变成一条高价值感官锚点。
 */
export interface WriteContext {
  /** 这句话关联出的锚点提案（含继承与推测），带置信度和来源 */
  proposals: AnchorProposal[];
  /** 处境标签：medical / loss / conflict / promise / sensory / effort */
  kinds: string[];
  /** 给人看的处境摘要 */
  scene: string;
  /** 溯源：这个解读基于哪几条旧记忆 */
  sourceIds: string[];
}

const KIND_WORDS: Record<string, string[]> = {
  medical: ["医院", "手术", "住院", "病理", "化疗", "打针", "输液", "急诊", "复查", "医生", "病房", "宠物医院", "结节"],
  loss: ["去世", "走了", "没了", "分手", "离职", "离开", "送走"],
  conflict: ["吵架", "生气", "冷战", "不理", "争执", "翻脸", "没在听", "根本不听", "没听"],
  promise: ["答应", "约好", "说好", "欠", "还上", "还钱", "下周", "月底", "一定", "别忘了"],
  sensory: ["味道", "气味", "消毒水", "声音", "光线", "阳光", "雨", "冷", "热", "手感", "触感"],
  effort: ["陪了", "守了", "熬了", "整晚", "三天", "一个月", "站了"],
};

/** 只看「这句话本身」能识别出什么处境 */
export function detectKinds(text: string): string[] {
  const out: string[] = [];
  for (const [kind, words] of Object.entries(KIND_WORDS)) {
    if (words.some((w) => text.includes(w))) out.push(kind);
  }
  return out;
}

/** 抑制反应：本该有反应却「没有」。单独成句时几乎零信息，配上处境才有意义。 */
export const SUPPRESSION = /没(叫|说话|出声|哭|吃|睡|动|吭声)|一直没|始终没|不吭声|没忍住/;

const NEIGHBOR_WINDOW_DAYS = 7;
const MAX_NEIGHBORS = 3;

/**
 * 拉出这句话的处境。
 *
 * 三道限制都是为了防幻觉：只用时间邻近（±7 天）、必须共享锚点、不用化石层。
 * 宁可背景不全，也不要背景错位——错位的背景会把记忆越读越偏。
 */
export function buildWriteContext(
  db: DatabaseSync,
  index: AnchorIndex,
  sentence: string,
  ts: number,
  proposals?: AnchorProposal[],
): WriteContext {
  // 没传提案就退回字面匹配；传了就用提案（它已经把别名、继承、指代都算进去了）
  const all = proposals ?? matchAnchors(index, sentence).map((hit) => ({
    anchorId: hit.anchorId,
    name: hit.name,
    kind: hit.kind,
    confidence: hit.confidence,
    source: "literal" as const,
    evidence: `句中出现「${hit.alias}」`,
  }));

  const usable = all.filter((p) => p.confidence >= 0.45);
  const kinds = new Set(detectKinds(sentence));
  const sourceIds: string[] = [];
  const sceneParts: string[] = [];

  if (usable.length > 0) {
    const placeholders = usable.map(() => "?").join(",");
    const window = NEIGHBOR_WINDOW_DAYS * 86_400_000;
    const rows = db
      .prepare(
        `SELECT e.id, e.title, e.ts, e.tier
           FROM events e JOIN event_anchors ea ON ea.event_id = e.id
          WHERE ea.anchor_id IN (${placeholders})
            AND e.ts BETWEEN ? AND ?
            AND e.tier != 'fossil'
          GROUP BY e.id
          ORDER BY ABS(e.ts - ?) ASC
          LIMIT ?`,
      )
      .all(...usable.map((a) => a.anchorId), ts - window, ts + window, ts, MAX_NEIGHBORS);

    for (const row of rows) {
      sceneParts.push(`「${String(row.title)}」`);
      sourceIds.push(String(row.id));
      for (const kind of detectKinds(String(row.title))) kinds.add(kind);
    }
  }

  return {
    proposals: all,
    kinds: [...kinds],
    scene: sceneParts.length > 0 ? sceneParts.join(" → ") : "",
    sourceIds,
  };
}

/** 处境越具体，这句话越值得留下。这是把 23% 误丢捞回来的那一项。 */
export function contextBoost(ctx: WriteContext, sentence: string): number {
  let boost = Math.min(1.0, ctx.kinds.length * 0.5);
  // 「到现在还记得」是人在告诉你：这条对我重要
  if (/记得|忘不了|印象最深/.test(sentence)) boost += 0.5;
  // 有具体处境做后盾，即使句子本身很平淡也不是噪音
  if (ctx.sourceIds.length > 0 && ctx.kinds.length > 0) boost += 0.2;
  return boost;
}

export function describeAnchorKinds(proposals: AnchorProposal[]): string {
  const order: AnchorKind[] = ["person", "place", "thing", "event", "theme"];
  const present = order.filter((k) => proposals.some((a) => a.kind === k));
  return present.join("/");
}
