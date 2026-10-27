import type { DatabaseSync } from "node:sqlite";
import type { AnchorKind } from "./types.ts";
import { matchAnchors, type AnchorIndex } from "./anchors.ts";

/**
 * 锚点提案（anchor proposal）。
 *
 * 旧做法是「在这句话里找锚点」——子串匹配到才算。
 * 新做法是「这句话能关联出哪些锚点」——可以靠字面，也可以靠别名、继承、指代、通名、共现。
 *
 * 关键区别：提案带置信度和来源。相关性仍然是图上的东西（两个节点之间才有边），
 * 但「这句话指向哪个节点」不必要求节点名字出现在句子里。
 */
export interface AnchorProposal {
  anchorId: string;
  name: string;
  kind: AnchorKind;
  /** 0–1。>=0.9 才允许写进事实绑定，其余只影响处境理解 */
  confidence: number;
  source: "literal" | "alias" | "inherited" | "pronoun" | "generic" | "cooccur";
  /** 给人看的依据：「它→团子」「前一句提到」 */
  evidence: string;
}

export interface ProposeInput {
  db: DatabaseSync;
  index: AnchorIndex;
  text: string;
  /** 前几句积累的提案（已由调用方衰减），用于继承与指代消解 */
  recent?: AnchorProposal[];
  /** 字面命中小于这个数才启用推测（L3） */
  literalGate?: number;
}

/** 指示代词 → 它可能指哪类锚点 */
const PRONOUN_KINDS: Array<{ word: string; kinds: AnchorKind[] }> = [
  { word: "它们", kinds: ["thing"] },
  { word: "她们", kinds: ["person"] },
  { word: "他们", kinds: ["person"] },
  { word: "它", kinds: ["thing"] },
  { word: "他", kinds: ["person"] },
  { word: "她", kinds: ["person"] },
  { word: "那家", kinds: ["place"] },
  { word: "这家", kinds: ["place"] },
  { word: "那里", kinds: ["place"] },
  { word: "那个", kinds: ["place", "thing"] },
  { word: "那事", kinds: ["event", "theme"] },
  { word: "那件事", kinds: ["event", "theme"] },
];

/** 通名 → 它所属的锚点类型（「楼下那家店」里的「店」） */
const GENERIC_KINDS: Array<{ word: string; kind: AnchorKind }> = [
  { word: "店", kind: "place" },
  { word: "公司", kind: "place" },
  { word: "医院", kind: "place" },
  { word: "小区", kind: "place" },
  { word: "学校", kind: "place" },
  { word: "宿舍", kind: "place" },
  { word: "老家", kind: "place" },
  { word: "房子", kind: "place" },
];

const L3_CONFIDENCE = { generic: 0.45, cooccur: 0.35 } as const;
const INHERIT_FACTOR = 0.6;

export function proposeAnchors(input: ProposeInput): AnchorProposal[] {
  const { db, index, text } = input;
  const recent = input.recent ?? [];
  const gate = input.literalGate ?? 2;

  const out = new Map<string, AnchorProposal>();
  const put = (p: AnchorProposal) => {
    const prev = out.get(p.anchorId);
    if (!prev || p.confidence > prev.confidence) out.set(p.anchorId, p);
  };

  // ── L1 字面 / 别名：出现在这句话里的名字
  const literal = matchAnchors(index, text);
  for (const hit of literal) {
    put({
      anchorId: hit.anchorId,
      name: hit.name,
      kind: hit.kind,
      confidence: hit.confidence,
      source: hit.confidence >= 0.99 ? "literal" : "alias",
      evidence: `句中出现「${hit.alias}」`,
    });
  }

  // ── L2 继承：这句话接着上一句说，锚点自然继承过来（常开，几乎无风险）
  for (const r of recent) {
    put({
      anchorId: r.anchorId,
      name: r.name,
      kind: r.kind,
      confidence: Math.min(0.85, r.confidence * INHERIT_FACTOR),
      source: "inherited",
      evidence: "前一句提到",
    });
  }

  // ── L3 推测：只在字面几乎没东西的时候启用——那时它的信息价值最大，噪声也最少
  if (literal.length < gate) {
    const candidates = [...out.values()].sort((a, b) => b.confidence - a.confidence);

    // 指代：「它」「他」指向最近提到的同类锚点。
    // 注意这里不是「再加一条」，而是**确认并提升**已有锚点——
    // 继承来的团子只是「上一句提到过」，被「它」指到之后才算真的进了这句话。
    for (const p of PRONOUN_KINDS) {
      if (!text.includes(p.word)) continue;
      const target = candidates.find((c) => p.kinds.includes(c.kind));
      if (!target) continue;
      if (!index.byId.has(target.anchorId)) continue;
      put({
        anchorId: target.anchorId,
        name: target.name,
        kind: target.kind,
        confidence: Math.min(0.85, target.confidence + 0.15),
        source: "pronoun",
        evidence: `「${p.word}」→${target.name}`,
      });
    }

    // 通名：「楼下那家店」里的「店」指向最近的 place 锚点
    for (const g of GENERIC_KINDS) {
      if (!text.includes(g.word)) continue;
      if ([...out.values()].some((c) => c.kind === g.kind && c.confidence >= 0.9)) continue;
      const target = candidates.find((c) => c.kind === g.kind);
      if (!target) continue;
      put({
        anchorId: target.anchorId,
        name: target.name,
        kind: target.kind,
        confidence: L3_CONFIDENCE.generic * target.confidence + 0.1,
        source: "generic",
        evidence: `「${g.word}」→${target.name}`,
      });
    }

    // 共现：图上连得紧的邻居也算提案（但要打折，且不递归）
    for (const c of candidates.slice(0, 3)) {
      const rows = db
        .prepare("SELECT src, dst, weight FROM edges WHERE (src = ? OR dst = ?) AND relation != 'same-as' AND weight >= 1.5")
        .all(c.anchorId, c.anchorId);
      for (const row of rows) {
        const otherId = String(row.src) === c.anchorId ? String(row.dst) : String(row.src);
        const rec = index.byId.get(otherId);
        if (!rec) continue;
        put({
          anchorId: otherId,
          name: rec.name,
          kind: rec.kind,
          confidence: L3_CONFIDENCE.cooccur * c.confidence,
          source: "cooccur",
          evidence: `常与${c.name}一起出现`,
        });
      }
    }
  }

  return [...out.values()]
    .filter((p) => p.confidence >= 0.2)
    .sort((a, b) => b.confidence - a.confidence);
}

/** 把新提案并进上下文，旧提案按距离衰减。这就是「锚点继承」的执行体。 */
export function mergeProposals(
  fresh: AnchorProposal[],
  older: AnchorProposal[],
  factor = 0.75,
  keep = 6,
): AnchorProposal[] {
  const out = new Map<string, AnchorProposal>();
  for (const p of fresh) out.set(p.anchorId, p);
  for (const p of older) {
    const next: AnchorProposal = { ...p, confidence: p.confidence * factor, source: "inherited" };
    if (next.confidence < 0.15) continue;
    const prev = out.get(next.anchorId);
    if (!prev || next.confidence > prev.confidence) out.set(next.anchorId, next);
  }
  return [...out.values()].sort((a, b) => b.confidence - a.confidence).slice(0, keep);
}

/** 只有高置信提案才允许写进事实绑定，避免推断污染事实检索 */
export function bindableProposals(list: AnchorProposal[]): AnchorProposal[] {
  return list.filter((p) => p.confidence >= 0.9);
}

/** 低置信提案：只影响处境理解，写进关系表时用弱权重 */
export function inferredProposals(list: AnchorProposal[]): AnchorProposal[] {
  return list.filter((p) => p.confidence >= 0.45 && p.confidence < 0.9);
}
