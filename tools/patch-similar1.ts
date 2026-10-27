import { readFileSync, writeFileSync } from "node:fs";

const p = "src/notes.ts";
let s = readFileSync(p, "utf8");

if (!s.includes("findSimilar")) {
  // 在文件末尾加一个相似度查找
  s += `

/**
 * 找一条「说的其实是同一件事」的记忆。
 *
 * 为什么要有：memory_save 一直在无条件插入，
 * 同一件事说三遍就是三条独立记忆，强度全是 1——
 * 所以「越常提起越牢」这个机制从来没生效过。
 */
export function findSimilar(
  db: DatabaseSync,
  text: string,
  day: string,
): { id: string; mentions: number; strength: number } | null {
  const clean = String(text ?? "").replace(/\\s+/g, "");
  if (clean.length < 6) return null;

  const rows = db
    .prepare("SELECT id, title, detail, mentions, strength FROM events WHERE day = ? AND archived = 0")
    .all(day) as Array<{ id: string; title: string; detail: string; mentions: number; strength: number }>;

  const grams = (t: string): Set<string> => {
    const s2 = String(t ?? "").replace(/[^\\u4e00-\\u9fa5a-zA-Z0-9]/g, "");
    const out = new Set<string>();
    for (let i = 0; i + 3 <= s2.length; i += 1) out.add(s2.slice(i, i + 3));
    return out;
  };

  const mine = grams(clean);
  if (mine.size === 0) return null;

  let best: { id: string; mentions: number; strength: number; score: number } | null = null;
  for (const r of rows) {
    const theirs = grams(r.detail);
    if (theirs.size === 0) continue;
    let hit = 0;
    for (const g of mine) if (theirs.has(g)) hit += 1;
    const score = hit / mine.size;
    if (score >= 0.6 && (!best || score > best.score)) {
      best = { id: r.id, mentions: Number(r.mentions ?? 1), strength: Number(r.strength ?? 1), score };
    }
  }
  return best ? { id: best.id, mentions: best.mentions, strength: best.strength } : null;
}
`;
  writeFileSync(p, s, "utf8");
  console.log("findSimilar 已加");
}
