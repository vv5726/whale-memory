import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 它自己的知识库。
 *
 * 和记忆的区别：
 *   记忆是「发生过的事」——有日期、有情绪、会淡忘。
 *   知识是「学到的东西」——不淡忘，分类存放，要用就查。
 *
 * 和词库的区别：
 *   词库是「一个词 = 一句释义」，很小。
 *   知识库是「一个主题 = 一段内容」，可以长，可以来自视频、文章、别人的话。
 *
 * 存成一个 json（好改、好备份），每条带分类和来源。
 */
export interface KnowledgeEntry {
  id: string;
  /** 分类：比如「中文」「记忆系统」「手机操作」「梗」 */
  category: string;
  title: string;
  content: string;
  /** 从哪儿学的：视频 BV 号、谁说的、哪个链接 */
  source?: string;
  tags?: string[];
  /** 挂在哪些锚点上：想到这些锚点时才想得起这条知识 */
  anchors?: string[];
  addedAt: number;
}

export interface KnowledgeBase {
  entries: KnowledgeEntry[];
}

function fileOf(dataDir: string): string {
  return join(dataDir, "knowledge.json");
}

export function loadKb(dataDir: string): KnowledgeBase {
  try {
    const f = fileOf(dataDir);
    if (!existsSync(f)) return { entries: [] };
    const raw = JSON.parse(readFileSync(f, "utf8")) as KnowledgeBase;
    return { entries: Array.isArray(raw?.entries) ? raw.entries : [] };
  } catch {
    return { entries: [] };
  }
}

function saveKb(dataDir: string, kb: KnowledgeBase): void {
  const f = fileOf(dataDir);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(kb, null, 2), "utf8");
}

/** 收一条知识。同一个分类下标题相同就更新，不重复堆。 */
export function addKnowledge(
  dataDir: string,
  input: {
    category: string;
    title: string;
    content: string;
    source?: string;
    tags?: string[];
    /** 显式指定挂哪些锚点 */
    anchors?: string[];
    /** 已知锚点名单，用来从正文里认 */
    knownAnchors?: string[];
  },
): KnowledgeEntry {
  const kb = loadKb(dataDir);
  const category = String(input.category ?? "未分类").trim() || "未分类";
  const title = String(input.title ?? "").trim();
  const content = String(input.content ?? "").trim();

  const exists = kb.entries.find((e) => e.category === category && e.title === title);
  if (exists) {
    exists.content = content;
    if (Array.isArray(input.anchors) && input.anchors.length > 0) exists.anchors = input.anchors;
    exists.source = input.source ?? exists.source;
    exists.tags = input.tags ?? exists.tags;
    saveKb(dataDir, kb);
    return exists;
  }

  const anchors = Array.isArray(input.anchors) && input.anchors.length > 0
    ? input.anchors.map((a) => a.trim()).filter(Boolean)
    : guessAnchors(`${category} ${title} ${content}`, input.knownAnchors ?? []);

  const entry: KnowledgeEntry = {
    id: `k_${Math.random().toString(36).slice(2, 10)}`,
    anchors,
    category,
    title,
    content,
    source: input.source,
    tags: input.tags,
    addedAt: Date.now(),
  };
  kb.entries.push(entry);
  saveKb(dataDir, kb);
  return entry;
}

/** 按关键词搜（标题、正文、标签都看） */
export function searchKnowledge(dataDir: string, query: string, limit = 5): KnowledgeEntry[] {
  const kb = loadKb(dataDir);
  const q = String(query ?? "").trim();
  if (q.length === 0) return kb.entries.slice(-limit);

  const terms = q.split(/\s+/).filter(Boolean);
  const scored = kb.entries
    .map((e) => {
      const hay = `${e.category} ${e.title} ${e.content} ${(e.tags ?? []).join(" ")}`;
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += 1;
      if (e.title.includes(q)) score += 2;
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((x) => x.e);
}

/** 列出分类（它自己要知道自己学过哪些门类） */
export function listCategories(dataDir: string): Array<{ category: string; count: number }> {
  const kb = loadKb(dataDir);
  const map = new Map<string, number>();
  for (const e of kb.entries) map.set(e.category, (map.get(e.category) ?? 0) + 1);
  return [...map.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
}


/** 从一段文字里认出已知的锚点名（长的优先，避免「记忆」吃掉「记忆结构」） */
export function guessAnchors(text: string, knownAnchors: string[]): string[] {
  const t = String(text ?? "");
  const sorted = [...knownAnchors].filter((a) => a.length >= 2).sort((a, b) => b.length - a.length);
  const out: string[] = [];
  for (const a of sorted) {
    if (t.includes(a) && !out.some((x) => x.includes(a))) out.push(a);
    if (out.length >= 6) break;
  }
  return out;
}

/** 想到这些锚点时，该想起哪些知识 */
export function kbForAnchors(dataDir: string, anchorNames: string[], limit = 4): KnowledgeEntry[] {
  const kb = loadKb(dataDir);
  const names = anchorNames.filter(Boolean);
  if (names.length === 0) return [];

  return kb.entries
    .filter((e) => (e.anchors ?? []).some((a) => names.includes(a)))
    .slice(-limit);
}

/** 手动给一条知识挂/摘锚点 */
export function linkKnowledge(dataDir: string, titleOrId: string, anchorName: string, remove = false): boolean {
  const kb = loadKb(dataDir);
  const e = kb.entries.find((x) => x.id === titleOrId || x.title === titleOrId);
  if (!e) return false;
  const cur = new Set(e.anchors ?? []);
  if (remove) cur.delete(anchorName);
  else cur.add(anchorName);
  e.anchors = [...cur];
  saveKb(dataDir, kb);
  return true;
}
