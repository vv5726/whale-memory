import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 词库：梗、黑话、口头禅、网络用语。
 *
 * 模型认识大部分正常中文，但**梗**是另一回事——
 * 「摇花手」「六六六」「栓Q」这种东西，不知道就是不知道，
 * 而且它会装懂（这是最糟的：装懂了后面全错）。
 *
 * 所以：不确定的词记下来，下次遇到就带上释义。
 * 词库是普通的 json，人能直接改，它也能自己往里加。
 */
export interface LexiconEntry {
  term: string;
  meaning: string;
  /** 从哪儿知道的：hhz 自己学到 / 对方解释 / 查到的 */
  source?: string;
  addedAt?: number;
}

type Lexicon = Record<string, LexiconEntry>;

function fileOf(dataDir: string): string {
  return join(dataDir, "lexicon.json");
}

export function loadLexicon(dataDir: string): Lexicon {
  try {
    const f = fileOf(dataDir);
    if (!existsSync(f)) return {};
    const raw = JSON.parse(readFileSync(f, "utf8")) as Lexicon;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function saveLexicon(dataDir: string, lex: Lexicon): void {
  const f = fileOf(dataDir);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(lex, null, 2), "utf8");
}

/** 学一个词（已经有就不覆盖，除非 force） */
export function learnTerm(dataDir: string, term: string, meaning: string, source = "学到的", saidBy?: { qq: string; name: string }): boolean {
  const t = String(term ?? "").trim();
  const m = String(meaning ?? "").trim();
  if (t.length === 0 || m.length === 0) return false;

  const lex = loadLexicon(dataDir);
  if (lex[t] && !lex[t].meaning.includes(m)) {
    lex[t].meaning = `${lex[t].meaning}；${m}`;
  } else if (!lex[t]) {
    lex[t] = { term: t, meaning: m, source, addedAt: Date.now() };
  } else {
    return false;
  }
  saveLexicon(dataDir, lex);
  return true;
}

/** 这句话里出现了哪些认识的词 */
export function matchTerms(dataDir: string, text: string): LexiconEntry[] {
  const lex = loadLexicon(dataDir);
  const t = String(text ?? "");
  const hits: LexiconEntry[] = [];
  for (const e of Object.values(lex)) {
    if (e.term.length >= 2 && t.includes(e.term)) hits.push(e);
  }
  return hits.slice(0, 6);
}

/** 种子：先把几个最常见的填上。以后它自己往里加。 */
export function seedLexicon(dataDir: string): number {
  const seeds: Array<[string, string]> = [
    ["摇花手", "抖音上的一种舞蹈动作，手在脸边转圈。表示嘚瑟、炫耀、得意的样子"],
    ["六六六", "「牛逼」的谐音，夸人厉害"],
    ["666", "夸人厉害"],
    ["栓Q", "「thank you」的谐音，多半是反讽或无奈"],
    ["绝了", "太好了 / 太离谱了，看语气"],
    ["离谱", "太不合理了"],
    ["破防", "被戳到痛处，情绪绷不住了"],
    ["emo", "情绪低落、难受"],
    ["yyds", "永远的神，夸到极点"],
    ["蚌埠住了", "「绷不住了」的谐音，忍不住笑或哭"],
    ["绷不住", "忍不住"],
    ["笑死", "很好笑，夸张说法"],
    ["裂开", "彻底崩了，受不了"],
    ["社死", "当众出丑到无地自容"],
    ["摆烂", "放弃努力，任它烂下去"],
    ["躺平", "不争了，就这样吧"],
    ["卷", "过度竞争"],
    ["摸鱼", "上班偷懒"],
    ["上强度", "加大力度"],
    ["打鸡血", "使劲鼓动"],
  ];

  let n = 0;
  for (const [term, meaning] of seeds) {
    if (learnTerm(dataDir, term, meaning, "种子")) n += 1;
  }
  return n;
}


/** 想到这些锚点时，该想起哪些词 */
export function termsForAnchors(dataDir: string, anchorNames: string[], limit = 4): Term[] {
  const lex = loadLexicon(dataDir);
  const names = anchorNames.filter(Boolean);
  if (names.length === 0) return [];
  const out: Term[] = [];
  for (const t of Object.values(lex)) {
    const as = (t as Term & { anchors?: string[] }).anchors ?? [];
    if (as.some((a) => names.includes(a))) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** 给一个词挂锚点（来源是谁就挂谁） */
export function attachTermAnchors(dataDir: string, term: string, anchors: string[]): void {
  const lex = loadLexicon(dataDir);
  const t = lex[term] as (Term & { anchors?: string[] }) | undefined;
  if (!t) return;
  const cur = new Set(t.anchors ?? []);
  for (const a of anchors) if (a) cur.add(a);
  t.anchors = [...cur];
  saveLexicon(dataDir, lex);
}
