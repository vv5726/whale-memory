/** 中文不需要分词也能做字面匹配：bigram + IDF 就够了，而且 2 字词也能命中。 */

const STOP_CHARS = new Set([..."的了吗呢是在和就都也很么那这不有我了你他她它们个一把被给对从到与或而且还但又再才只是会能要想说做"]);

export function bigrams(text: string): Set<string> {
  const cleaned = [...text].filter((c) => /[\u4e00-\u9fa5a-zA-Z0-9]/.test(c)).join("");
  const out = new Set<string>();
  for (let i = 0; i < cleaned.length - 1; i += 1) {
    const gram = cleaned.slice(i, i + 2);
    if (STOP_CHARS.has(gram[0]) && STOP_CHARS.has(gram[1])) continue;
    out.add(gram);
  }
  return out;
}

export function lexicalOverlap(query: string, text: string): number {
  const q = bigrams(query);
  if (q.size === 0) return 0;
  const t = bigrams(text);
  let hit = 0;
  for (const gram of q) if (t.has(gram)) hit += 1;
  return hit / q.size;
}
