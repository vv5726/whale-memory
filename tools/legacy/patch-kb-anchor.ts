import { readFileSync, writeFileSync } from "node:fs";

// ── ① knowledge.ts：知识条目挂锚点 ──
{
  const p = "src/knowledge.ts";
  let s = readFileSync(p, "utf8");

  s = s.replace(
    "  tags?: string[];\n  addedAt: number;",
    [
      "  tags?: string[];",
      "  /** 挂在哪些锚点上：想到这些锚点时才想得起这条知识 */",
      "  anchors?: string[];",
      "  addedAt: number;",
    ].join("\n"),
  );

  s = s.replace(
    "  const entry: KnowledgeEntry = {\n    id: `k_${Math.random().toString(36).slice(2, 10)}`,",
    [
      "  const anchors = Array.isArray(input.anchors) && input.anchors.length > 0",
      "    ? input.anchors.map((a) => a.trim()).filter(Boolean)",
      "    : guessAnchors(`${category} ${title} ${content}`, input.knownAnchors ?? []);",
      "",
      "  const entry: KnowledgeEntry = {",
      "    id: `k_${Math.random().toString(36).slice(2, 10)}`,",
      "    anchors,",
    ].join("\n"),
  );

  // 入参类型加 anchors / knownAnchors
  s = s.replace(
    "  input: { category: string; title: string; content: string; source?: string; tags?: string[] },",
    "  input: {\n    category: string;\n    title: string;\n    content: string;\n    source?: string;\n    tags?: string[];\n    /** 显式指定挂哪些锚点 */\n    anchors?: string[];\n    /** 已知锚点名单，用来从正文里认 */\n    knownAnchors?: string[];\n  },",
  );

  // 更新分支也要能改 anchors
  s = s.replace(
    "    exists.content = content;",
    "    exists.content = content;\n    if (Array.isArray(input.anchors) && input.anchors.length > 0) exists.anchors = input.anchors;",
  );

  // 追加：认锚点 / 按锚点搜 / 手动挂
  s += `

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
`;
  writeFileSync(p, s, "utf8");
  console.log("knowledge：锚点关联已加");
}
