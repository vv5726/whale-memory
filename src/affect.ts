import type { Affect } from "./types.ts";
import type { WriteContext } from "./context.ts";
import { SUPPRESSION } from "./context.ts";
import { clamp, splitClauses, truncate } from "./util.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 情绪词典。原型不接 LLM，用词典算 valence / arousal，
 * 保证离线可复现；生产环境这里应换成模型抽取（接口一致）。
 */
const POSITIVE: Record<string, { v: number; a: number; tag: string }> = {
  开心: { v: 0.8, a: 0.5, tag: "愉快" },
  高兴: { v: 0.8, a: 0.5, tag: "愉快" },
  笑: { v: 0.7, a: 0.45, tag: "愉快" },
  顺利: { v: 0.7, a: 0.3, tag: "安心" },
  踏实: { v: 0.6, a: 0.2, tag: "安心" },
  放心: { v: 0.6, a: 0.2, tag: "安心" },
  松了口气: { v: 0.6, a: 0.35, tag: "释然" },
  缓过来: { v: 0.5, a: 0.3, tag: "释然" },
  哭: { v: 0.2, a: 0.9, tag: "激动" },
  良性: { v: 0.85, a: 0.7, tag: "释然" },
  升职: { v: 0.8, a: 0.6, tag: "成就" },
  温暖: { v: 0.7, a: 0.3, tag: "亲密" },
  牵手: { v: 0.6, a: 0.4, tag: "亲密" },
  喜欢: { v: 0.7, a: 0.4, tag: "亲密" },
  火锅: { v: 0.6, a: 0.4, tag: "愉快" },
};

const NEGATIVE: Record<string, { v: number; a: number; tag: string }> = {
  焦虑: { v: -0.7, a: 0.7, tag: "焦虑" },
  悬着: { v: -0.6, a: 0.6, tag: "焦虑" },
  难过: { v: -0.8, a: 0.6, tag: "低落" },
  凉了: { v: -0.7, a: 0.5, tag: "挫败" },
  硬答: { v: -0.6, a: 0.6, tag: "挫败" },
  后悔: { v: -0.7, a: 0.5, tag: "后悔" },
  吵: { v: -0.75, a: 0.85, tag: "冲突" },
  吵架: { v: -0.8, a: 0.9, tag: "冲突" },
  住院: { v: -0.7, a: 0.7, tag: "担忧" },
  手术: { v: -0.7, a: 0.8, tag: "担忧" },
  病理: { v: -0.5, a: 0.7, tag: "担忧" },
  生病: { v: -0.75, a: 0.75, tag: "担忧" },
  肾: { v: -0.7, a: 0.7, tag: "担忧" },
  打针: { v: -0.6, a: 0.6, tag: "担忧" },
  累: { v: -0.5, a: 0.4, tag: "疲惫" },
  没忍住: { v: -0.4, a: 0.8, tag: "激动" },
  谁都没说话: { v: -0.5, a: 0.5, tag: "疏离" },
  不好意思: { v: -0.3, a: 0.3, tag: "局促" },
  躲在: { v: -0.4, a: 0.5, tag: "担忧" },
};

const AROUSAL_BOOSTERS: Array<{ word: string; add: number }> = [
  { word: "！", add: 0.15 },
  { word: "!", add: 0.15 },
  { word: "突然", add: 0.15 },
  { word: "一直", add: 0.1 },
  { word: "半小时", add: 0.1 },
  { word: "一小时", add: 0.1 },
  { word: "一个多小时", add: 0.1 },
  { word: "非要", add: 0.12 },
  { word: "差点", add: 0.12 },
];

const NEUTRAL_TAG = "平静";

/**
 * 当前生效的词表 = 代码里的默认词典 + data/affect-words.json。
 *
 * 合并规则（2026-10-27 加）：
 *   ① 默认那 40 个词永远先装上（地板，掏不空）
 *   ② 文件里的词逐个并入：没见过就新增，同名就用文件那版
 *   ③ disable 里点名的词从结果里拿掉（比如把「笑」关掉，改用「苦笑」「笑死」）
 *   ④ 文件不存在 / 写坏了 → 只用默认，并打一行日志
 *
 * 她通过 data_file 改这个文件；改完下一次打分就生效（不用重启）。
 */
interface AffectedWord {
  v: number;
  a: number;
  tag: string;
}

interface WordsFile {
  positive?: Record<string, Partial<AffectedWord>>;
  negative?: Record<string, Partial<AffectedWord>>;
  boosters?: Array<{ word?: string; add?: number }>;
  disable?: string[];
}

const active = {
  positive: { ...POSITIVE } as Record<string, AffectedWord>,
  negative: { ...NEGATIVE } as Record<string, AffectedWord>,
  boosters: [...AROUSAL_BOOSTERS],
  fromFile: new Set<string>(),
  disabled: new Set<string>(),
};

function normalizeWord(raw: Partial<AffectedWord> | undefined): AffectedWord | null {
  if (!raw || typeof raw !== "object") return null;
  const v = Number(raw.v);
  const a = Number(raw.a);
  if (!Number.isFinite(v) || !Number.isFinite(a)) return null;
  return { v: clamp(v, -1, 1), a: clamp(a, 0, 1), tag: String(raw.tag ?? NEUTRAL_TAG).slice(0, 8) };
}

/** 启动时调一次；她改了文件之后也调一次（data_file 会调） */
export function initAffectWords(dataDir: string): void {
  const positive: Record<string, AffectedWord> = { ...POSITIVE };
  const negative: Record<string, AffectedWord> = { ...NEGATIVE };
  const boosters = [...AROUSAL_BOOSTERS];
  const fromFile = new Set<string>();
  const disabled = new Set<string>();

  const file = join(dataDir, "affect-words.json");
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, "utf8")) as WordsFile;
      for (const [word, w] of Object.entries(raw.positive ?? {})) {
        const n = normalizeWord(w);
        if (!n) continue;
        positive[word] = n;
        fromFile.add(word);
      }
      for (const [word, w] of Object.entries(raw.negative ?? {})) {
        const n = normalizeWord(w);
        if (!n) continue;
        negative[word] = n;
        fromFile.add(word);
      }
      for (const b of raw.boosters ?? []) {
        const word = String(b?.word ?? "").trim();
        const add = Number(b?.add);
        if (word.length > 0 && Number.isFinite(add)) boosters.push({ word, add: clamp(add, 0, 0.5) });
      }
      for (const d of raw.disable ?? []) disabled.add(String(d));
      for (const d of disabled) {
        delete positive[d];
        delete negative[d];
      }
    }
  } catch (e) {
    console.warn(`[affect] 情绪词表读不了，这次只用默认词典：${e instanceof Error ? e.message : e}`);
  }

  active.positive = positive;
  active.negative = negative;
  active.boosters = boosters;
  active.fromFile = fromFile;
  active.disabled = disabled;
}

/** 给她看的：现在生效的词表，以及哪些是她加的 */
export function affectWordsSnapshot(): {
  positive: Record<string, AffectedWord>;
  negative: Record<string, AffectedWord>;
  boosters: Array<{ word: string; add: number }>;
  fromFile: string[];
  disabled: string[];
} {
  return {
    positive: active.positive,
    negative: active.negative,
    boosters: active.boosters,
    fromFile: [...active.fromFile],
    disabled: [...active.disabled],
  };
}

export function analyzeAffect(text: string, ctx?: WriteContext): Affect {
  let aMax = 0;
  let aSum = 0;
  let hits = 0;
  const found: Array<{ v: number; a: number; tag: string }> = [];

  for (const [word, w] of [...Object.entries(active.positive), ...Object.entries(active.negative)]) {
    if (!text.includes(word)) continue;
    aSum += w.a;
    aMax = Math.max(aMax, w.a);
    hits += 1;
    found.push(w);
  }

  for (const b of active.boosters) {
    if (text.includes(b.word)) aSum += b.add;
  }

  // 情绪标签取「最重」的那个词，而不是最先命中的那个：
  // 「病理出来了，是良性」应该记成释然，不是担忧。
  found.sort((x, y) => Math.abs(y.v) * (y.a + 0.3) - Math.abs(x.v) * (x.a + 0.3));
  const dominant = found[0] ?? null;

  let valence = dominant ? clamp(dominant.v, -1, 1) : 0;
  let arousal = hits === 0 ? clamp(aSum * 0.5, 0, 1) : clamp(aMax * 0.7 + (aSum / (hits + 2)) * 0.6, 0, 1);
  let tags = [...new Set(found.map((f) => f.tag))];

  // 有了处境之后重读一遍：情绪很多时候不在句子里，在处境里
  if (ctx) {
    const adjusted = applyContext(text, valence, arousal, tags, ctx);
    valence = adjusted.valence;
    arousal = adjusted.arousal;
    tags = adjusted.tags;
  }

  const clauses = scoreClauses(text);
  const summary = buildSummary(clauses, valence, arousal, tags);
  return { valence: round2(valence), arousal: round2(arousal), tags, summary, core: buildCoreFragment(clauses) };
}

/**
 * 语境修正。
 *
 * 这些规则仍然是「规则」，不是理解——它们治不了根本问题，只证明一件事：
 * **同样的词，在不同处境里应该读出不同的情绪**，而现在的结构允许这件事发生。
 *
 * 真正的版本应该是：把 text + ctx.scene 一起交给模型，由它给出这五个字段。
 */
function applyContext(
  text: string,
  valence: number,
  arousal: number,
  tags: string[],
  ctx: WriteContext,
): { valence: number; arousal: number; tags: string[] } {
  const kinds = new Set(ctx.kinds);
  const out = { valence, arousal, tags: [...tags] };

  const medicalScene = kinds.has("medical") || kinds.has("loss");
  const suppression = SUPPRESSION.test(text);

  if (suppression && medicalScene) {
    // 「它一直没叫」——它不是没情绪，它是在忍着。这一条单独看永远是 0 分。
    out.valence = -0.55;
    out.arousal = Math.max(out.arousal, 0.62);
    out.tags.unshift("心疼");
    return out;
  }

  if (kinds.has("conflict")) {
    out.arousal = Math.max(out.arousal, 0.5);
    if (out.valence === 0) out.valence = -0.2;
    if (!out.tags.includes("冲突")) out.tags.unshift("冲突");
    return out;
  }

  // 感官锚点比承诺更值得先判：「消毒水味到现在还记得」说的不是约定
  if (kinds.has("sensory") && /记得|忘不了|印象最深/.test(text)) {
    out.valence = Math.max(out.valence, 0.05);
    out.arousal = Math.max(out.arousal, 0.5);
    out.tags.unshift("怀念");
    return out;
  }

  if (kinds.has("medical") && !/医院|手术|住院|病理|病/.test(text)) {
    // 句子里没提病，但处境是看病——说明这句是那件事的余波
    out.valence = Math.min(out.valence, -0.25);
    out.arousal = Math.max(out.arousal, 0.42);
    out.tags.unshift("担忧");
    return out;
  }

  if (kinds.has("promise")) {
    // 承诺本身不带情绪色彩，但它有「分量」：这类句子该被记住
    out.arousal = Math.max(out.arousal, 0.34);
    out.tags.unshift("承诺");
  }

  return out;
}

interface ScoredClause {
  text: string;
  score: number;
  index: number;
}

function scoreClauses(text: string): ScoredClause[] {
  return splitClauses(text).map((c, index) => {
    let s = 0;
    for (const [word, w] of [...Object.entries(active.positive), ...Object.entries(active.negative)]) {
      if (c.includes(word)) s += Math.abs(w.v) * 2;
    }
    // 完全没有情绪词时，长一点的完整小句更像「一个画面」
    s += Math.min(0.6, [...c].length / 60);
    return { text: c, score: s, index };
  });
}

/**
 * 核心片段 = 最能唤起情绪的一两个小句。
 * 只挑一个会让片段失去信息（「妈妈住院了」谁都想不起是哪一次），
 * 挑两个刚好是「一个画面」的长度。
 */
function buildCoreFragment(clauses: ScoredClause[]): string {
  if (clauses.length === 0) return "";
  const byScore = [...clauses].sort((a, b) => b.score - a.score || a.index - b.index);
  const picked = byScore.slice(0, 2).sort((a, b) => a.index - b.index);
  return truncate(picked.map((c) => c.text).join("，"), 48);
}

function buildSummary(clauses: ScoredClause[], valence: number, arousal: number, tags: string[]): string {
  const focus = clauses.length === 0 ? "" : [...clauses].sort((a, b) => b.score - a.score)[0].text;
  const tag = tags[0] ?? NEUTRAL_TAG;
  const tone = valence >= 0.35 ? "心里是暖的" : valence <= -0.35 ? "心里发沉" : "说不上什么滋味";
  const intensity = arousal >= 0.7 ? "，到现在想起来还有点堵" : arousal >= 0.45 ? "，当时情绪挺明显的" : "";
  // 混合情绪是正常的（劫后余生本来就是又暖又堵），所以这里只负责把话说通顺
  return truncate(`${focus ? `${focus}；` : ""}${tag}，${tone}${intensity}`, 60);
}

export function moodLabel(valence: number, arousal: number): string {
  if (arousal >= 0.65 && valence < -0.2) return "烦躁";
  if (arousal >= 0.65 && valence > 0.2) return "亢奋";
  if (valence <= -0.3) return "低落";
  if (valence >= 0.3) return "温和";
  if (arousal <= 0.2) return "发蔫";
  return "平静";
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
