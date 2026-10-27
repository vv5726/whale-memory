/**
 * 模型接入的端到端烟雾测试（不需要真模型，用回放适配器）。
 *
 * 验证五件事：
 *  1. 模型输出 → 校验 → 落库，事件字段完整，能新增锚点
 *  2. 重放同一段对话：不再调模型（冻结），也不重复入库（去重）
 *  3. 模型写入的记忆能被检索到
 *  4. 模型输出不可用时自动退回启发式，不丢数据
 *  5. 模型判断的约定只进待审队列，不自动钉住
 *
 * 用法：node tools/llm-smoke.ts
 */
import { rmSync } from "node:fs";
import { DEFAULT_CONFIG, withOverrides } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { ingestTurns } from "../src/extract.ts";
import { readDataset, seedFromFile } from "../src/eval.ts";
import { recall, describeEvent } from "../src/recall.ts";
import { sleepAsync } from "../src/sleep.ts";
import { ReplayAdapter } from "../src/llm/adapter.ts";
import { dayKeyToTs } from "../src/util.ts";

const GOOD_DB = "data/llm-smoke.db";
const BAD_DB = "data/llm-smoke-bad.db";
const turns = readDataset("eval/dataset.jsonl").filter((t) => t.day === "2026-06-30");
const base = withOverrides(DEFAULT_CONFIG, { contextBudgetTokens: 100_000, extractor: "llm" as const });

function clean(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${path}${suffix}`);
    } catch {
      // 不存在就算了
    }
  }
}

function freshDb(path: string) {
  clean(path);
  const db = openDb(path);
  seedFromFile(db, "data/seed-anchors.json");
  ingestTurns(db, turns);
  return db;
}

async function main(): Promise<void> {
  const good = freshDb(GOOD_DB);
  const adapter = new ReplayAdapter("eval/llm-replay.json");
  const cfg = withOverrides(base, { llmBaseUrl: "replay:eval/llm-replay.json" });
  const nowTs = dayKeyToTs("2026-06-30") + 8 * 3600_000;

  console.log("1. 模型抽取 → 校验 → 落库");
  const first = await sleepAsync(good, cfg, { nowTs }, adapter);
  console.log(`   抽出 ${first.llm?.inserted} 条　新锚点 ${first.llm?.newAnchors}　模型调用 ${adapter.calls} 次`);
  for (const r of good.prepare("SELECT * FROM events ORDER BY ts").all()) {
    console.log(`   · [${r.tier}] ${r.title}`);
    console.log(`     ｜情绪：${r.affect_summary}（v ${r.affect_valence} / a ${r.affect_arousal}）`);
  }
  const created = good.prepare("SELECT name, kind FROM anchors WHERE name IN ('肾病','宠物医院')").all();
  console.log(`   模型新建的锚点：${created.map((a) => `${a.name}(${a.kind})`).join("、") || "（无）"}`);

  console.log("");
  console.log("2. 重放同一段对话：不重抽、不重复入库");
  ingestTurns(good, turns);
  const second = await sleepAsync(good, cfg, { nowTs }, adapter);
  console.log(`   冻结复用 ${second.llm?.frozen} 天　新增 ${second.llm?.inserted} 条　模型调用累计 ${adapter.calls} 次（应仍为 1）`);
  const total = Number(good.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
  console.log(`   事件总数 ${total}（应为 3，没有翻倍）`);

  console.log("");
  console.log("3. 检索：模型写入的记忆能不能被想起来");
  for (const q of ["团子最近怎么了", "团子复查是哪天"]) {
    const r = recall(good, cfg, q, { nowTs: dayKeyToTs("2026-10-12") });
    console.log(`   Q: ${q}`);
    for (const c of r.factual.slice(0, 2)) {
      console.log(`     ${c.breakdown.total.toFixed(2)} [${c.event.tier}] ${describeEvent(c.event).slice(0, 46)}`);
    }
  }

  console.log("");
  console.log("4. 模型判断的约定只进待审");
  const pending = good.prepare("SELECT id, reason FROM pending_pins").all();
  const pinned = Number(good.prepare("SELECT COUNT(*) AS c FROM events WHERE pinned = 1").get()?.c ?? 0);
  console.log(`   待审 ${pending.length} 条　自动钉住 ${pinned} 条`);
  for (const p of pending) console.log(`     · ${String(p.reason)}`);
  good.close();

  console.log("");
  console.log("5. 模型输出不可用 → 退回启发式");
  const bad = freshDb(BAD_DB);
  const badCfg = withOverrides(base, { llmBaseUrl: "replay:eval/llm-replay-bad.json" });
  const stats = await sleepAsync(bad, badCfg, { nowTs });
  const count = Number(bad.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
  console.log(`   模型失败 ${stats.llm?.failed} 天　启发式补上 ${stats.eventsExtracted} 条　库里共 ${count} 条`);
  console.log(`   ${count > 0 ? "✓ 兜底生效：模型抽风没有导致丢数据" : "✗ 兜底失败"}`);
  bad.close();
}

await main();
