/**
 * 诊断脚本：对比三种读取方式
 *   ① 只看句子（词表打分）
 *   ② 先检索处境再读（字面锚点 → 处境）
 *   ③ 锚点提案（字面 + 别名 + 继承 + 指代 + 通名 + 共现）+ 处境
 *
 * 用法：node tools/diagnose-extract.ts
 */
import { loadAnchorIndex } from "../src/anchors.ts";
import { analyzeAffect } from "../src/affect.ts";
import { openDb } from "../src/db.ts";
import { buildWriteContext, contextBoost } from "../src/context.ts";
import { proposeAnchors, mergeProposals, type AnchorProposal } from "../src/propose.ts";
import { seedFromFile, readDataset, runFullEval } from "../src/eval.ts";
import { ingestTurns } from "../src/extract.ts";
import { sleep } from "../src/sleep.ts";
import { DEFAULT_CONFIG, withOverrides } from "../src/config.ts";
import { dayKeyToTs, splitSentences } from "../src/util.ts";

const THRESHOLD = 1.2;
const index = loadAnchorIndex(openDb(":memory:"));

// 先按天重放，让库里积累出「过去」，处境才有东西可查
const scratch = openDb("data/diagnose.db");
scratch.exec("DELETE FROM events; DELETE FROM event_anchors; DELETE FROM edges; DELETE FROM turns; DELETE FROM anchors; DELETE FROM cold_archive;");
seedFromFile(scratch, "data/seed-anchors.json");
const turns = readDataset("eval/dataset.jsonl");
const byDay = new Map<string, typeof turns>();
for (const t of turns) {
  if (!byDay.has(t.day)) byDay.set(t.day, []);
  byDay.get(t.day)!.push(t);
}
const days = [...byDay.keys()].sort();
for (const day of days) {
  ingestTurns(scratch, byDay.get(day)!);
  sleep(scratch, withOverrides(DEFAULT_CONFIG, { contextBudgetTokens: 3600 }), {
    nowTs: dayKeyToTs(day) + 8 * 3600_000,
  });
}
const dbIndex = loadAnchorIndex(scratch);

interface Line {
  sentence: string;
  day: string;
  ts: number;
  ctxOnly: number;
  proposed: number;
  proposals: AnchorProposal[];
  scene: string;
  kind: string;
  affectPlain: number;
  affectCtx: number;
  affectProposed: number;
  tagPlain: string;
  tagProposed: string;
}

const lines: Line[] = [];

for (const day of days) {
  let recent: AnchorProposal[] = [];
  for (const t of byDay.get(day)!) {
    if (t.role !== "user") continue;
    const ts = dayKeyToTs(day);
    for (const sentence of splitSentences(t.text)) {
      // ① 只看句子
      const plainAffect = analyzeAffect(sentence);
      const literal = proposeAnchors({ db: scratch, index: dbIndex, text: sentence, recent: [] })
        .filter((p) => p.source === "literal" || p.source === "alias");
      const baseScore =
        Math.min(2, literal.length) * 2 + plainAffect.arousal * 3 + (sentence.length >= 20 ? 0.5 : 0) + (/我|咱/.test(sentence) ? 0.4 : 0);

      // ② 只有字面锚点 + 处境
      const ctxLiteral = buildWriteContext(scratch, dbIndex, sentence, ts);
      const ctxOnlyAffect = analyzeAffect(sentence, ctxLiteral);
      const ctxOnly =
        Math.min(2, literal.length) * 2 +
        ctxOnlyAffect.arousal * 3 +
        (sentence.length >= 20 ? 0.5 : 0) +
        (/我|咱/.test(sentence) ? 0.4 : 0) +
        contextBoost(ctxLiteral, sentence);

      // ③ 锚点提案 + 处境
      const proposals = proposeAnchors({ db: scratch, index: dbIndex, text: sentence, recent });
      const ctx = buildWriteContext(scratch, dbIndex, sentence, ts, proposals);
      const proposedAffect = analyzeAffect(sentence, ctx);
      const grounded = proposals.filter((p) => p.source === "literal" || p.source === "alias");
      const proposed =
        Math.min(2, grounded.length) * 2 +
        proposedAffect.arousal * 3 +
        (sentence.length >= 20 ? 0.5 : 0) +
        (/我|咱/.test(sentence) ? 0.4 : 0) +
        contextBoost(ctx, sentence);

      lines.push({
        sentence,
        day,
        ts,
        ctxOnly,
        proposed,
        proposals,
        scene: ctx.scene,
        kind: ctx.kinds.join(","),
        affectPlain: plainAffect.arousal,
        affectCtx: ctxOnlyAffect.arousal,
        affectProposed: proposedAffect.arousal,
        tagPlain: plainAffect.tags[0] ?? "平静",
        tagProposed: proposedAffect.tags[0] ?? "平静",
      });

      recent = mergeProposals(proposals, recent);
      void baseScore;
    }
  }
}

const keep = (threshold: number, pick: (l: Line) => number) => lines.filter((l) => pick(l) >= threshold).length;

console.log(`句子 ${lines.length} 条`);
console.log(`  ①只看句子            保留 ${keep(THRESHOLD, (l) => l.affectPlain * 3 + 0)}（仅作对照：不含锚点分）`);
console.log(`  ②字面锚点 + 处境      保留 ${keep(THRESHOLD, (l) => l.ctxOnly)}　丢弃率 ${((1 - keep(THRESHOLD, (l) => l.ctxOnly) / lines.length) * 100).toFixed(0)}%`);
console.log(`  ③锚点提案 + 处境      保留 ${keep(THRESHOLD, (l) => l.proposed)}　丢弃率 ${((1 - keep(THRESHOLD, (l) => l.proposed) / lines.length) * 100).toFixed(0)}%`);

console.log("");
console.log("=== 提案救回来的句子（②丢弃、③保留） ===");
for (const l of lines) {
  if (l.ctxOnly >= THRESHOLD || l.proposed < THRESHOLD) continue;
  const inferred = l.proposals.filter((p) => !["literal", "alias"].includes(p.source));
  console.log(`  ${l.ctxOnly.toFixed(2)} → ${l.proposed.toFixed(2)}　${l.sentence}`);
  console.log(`     处境：[${l.kind}] ${l.scene.slice(0, 44) || "（无）"}`);
  console.log(`     推断提案：${inferred.map((p) => `${p.name}(${p.confidence.toFixed(2)} ${p.source}: ${p.evidence})`).join("；") || "（无）"}`);
  console.log(`     情绪：${l.tagPlain} → ${l.tagProposed}`);
}

console.log("");
console.log("=== 仍然被丢弃的句子 ===");
for (const l of lines) {
  if (l.proposed >= THRESHOLD) continue;
  console.log(`  [${l.proposed.toFixed(2)}] ${l.sentence}`);
  console.log(`     提案：${l.proposals.map((p) => `${p.source}:${p.name}`).join("、") || "（无）"}　处境：[${l.kind || "无"}]`);
}

console.log("");
console.log("=== 提案来源分布 ===");
const bySource = new Map<string, number>();
for (const l of lines) for (const p of l.proposals) bySource.set(p.source, (bySource.get(p.source) ?? 0) + 1);
for (const [source, count] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${source.padEnd(10)} ${count}`);
}

console.log("");
console.log("=== 定点抽查：代词与感官锚点 ===");
for (const l of lines.filter((x) => /没叫|下雨|消毒水|打印店|那家/.test(x.sentence))) {
  console.log(`\n「${l.sentence}」`);
  console.log(`  提案：${l.proposals.map((p) => `${p.name}(${p.source} ${p.confidence.toFixed(2)})`).join("、") || "（无）"}`);
  console.log(`  处境：[${l.kind || "无"}] ${l.scene.slice(0, 50) || "（无）"}`);
  console.log(`  情绪：只看句子 ${l.tagPlain}(${l.affectPlain}) → 提案+处境 ${l.tagProposed}(${l.affectProposed})`);
}

console.log("");
console.log("=== 召回率是否被拖累 ===");
for (const budget of [650, 1200, 2400]) {
  const r = runFullEval({
    dbPath: "data/diagnose-eval.db",
    datasetPath: "eval/dataset.jsonl",
    probesPath: "eval/probes.json",
    seedsPath: "data/seed-anchors.json",
    cfg: withOverrides(DEFAULT_CONFIG, { contextBudgetTokens: budget }),
  }).report;
  const t = r.finalTotals;
  console.log(`  预算 ${budget}：${t.detailed.count}/${t.compressed.count}/${t.fossil.count} 条　召回率 ${(r.hitRate * 100).toFixed(1)}%　丢失 ${r.lostFacts}`);
}
