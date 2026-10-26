/**
 * 只读对比：同一句查询，两种出法各给 5 条。
 *
 * A 现状：按分数取前 5（重复的会占好几个位）
 * B 收敛：先按标题相似度聚类，每组只出最高分那条，再取前 5
 *
 * 不写任何数据。
 */
import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { recall } from "../src/recall.ts";
import { DEFAULT_CONFIG, withOverrides } from "../src/config.ts";

const query = process.argv[2] ?? "小糖人";
const cfg = loadBotConfig();
const db = openDb("data/memory.db");
const memoryCfg = withOverrides(DEFAULT_CONFIG, {
  contextBudgetTokens: cfg.contextBudgetTokens,
  extractor: cfg.useLlmExtractor ? "llm" : "heuristic",
  llmBaseUrl: cfg.ollamaBaseUrl,
  llmModel: cfg.ollamaModel,
});

// 放宽候选：先拿得多一点，再分别收敛
const r = recall(db, memoryCfg, query, { sessionId: "cmp", factTopK: 20 });
const scored = (r.scored ?? []) as Array<{ title: string; score: number; evidence: number }>;

console.log(`查询：「${query}」　候选 ${scored.length} 条\n`);

console.log("A 现状（按分数取前 5）：");
for (const s of scored.slice(0, 5)) {
  console.log(`  ${s.score.toFixed(2)}  ${String(s.title).slice(0, 40)}`);
}

// B：按标题 2 字组聚类
const grams = (t: string): Set<string> => {
  const c = String(t).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
  const set = new Set<string>();
  for (let i = 0; i + 2 <= c.length; i += 1) set.add(c.slice(i, i + 2));
  return set;
};
const sim = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit += 1;
  return hit / Math.min(a.size, b.size);
};

const clusters: Array<{ best: { title: string; score: number }; n: number }> = [];
for (const s of scored) {
  const g = grams(s.title);
  const hit = clusters.find((c) => sim(c.g, g) >= 0.6);
  if (hit) {
    hit.n += 1;
    if (s.score > hit.best.score) hit.best = { title: s.title, score: s.score };
  } else {
    clusters.push({ g, best: { title: s.title, score: s.score }, n: 1 } as never);
  }
}
clusters.sort((a, b) => b.best.score - a.best.score);

console.log("\nB 收敛（同组只留最高分那条）：");
for (const c of clusters.slice(0, 5)) {
  console.log(`  ${c.best.score.toFixed(2)}  ${String(c.best.title).slice(0, 40)}　（这组共 ${c.n} 条）`);
}

console.log(`\n候选 ${scored.length} 条 → 收敛后 ${clusters.length} 组`);
db.close();
