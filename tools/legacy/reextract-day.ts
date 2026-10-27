/**
 * 按天重抽：只处理一天，抽完就地做一次去重，不碰别的天。
 *
 * 上次一次全抽，92 → 254。原因是：
 *   ① 没有按天隔离，重复被算进不同天的组里
 *   ② 抽完没去重
 *   ③ 缓存签名没变，其实还在用旧结果（这一条当时没发现）
 */
import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { loadAnchorIndex } from "../src/anchors.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";
import { extractDayWithLlm } from "../src/llm/extract.ts";

const day = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const cfg = loadBotConfig();
const db = openDb("data/memory.db");

const turns = db
  .prepare("SELECT id, role, text, speaker_id FROM turns WHERE day = ? ORDER BY seq")
  .all(day) as Array<{ id: string; role: string; text: string; speaker_id: string }>;

console.log(`【${day}】${turns.length} 轮对话`);
if (turns.length < 2) {
  console.log("对话太少，跳过");
  process.exit(0);
}

const before = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);

// 清掉这一天的抽取缓存（签名里带规则哈希，本来也会变）
db.prepare("DELETE FROM llm_extractions WHERE day = ?").run(day);

const adapter = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);
const index = loadAnchorIndex(db);

// 60 轮一批
const CHUNK = 60;
let inserted = 0;
let reinforced = 0;
for (let i = 0; i < turns.length; i += CHUNK) {
  const chunk = turns.slice(i, i + CHUNK).map((t) => ({
    id: t.id,
    role: t.role,
    text: t.text,
    speakerId: t.speaker_id,
  }));
  const r = await extractDayWithLlm(db, cfg, index, adapter, day, chunk, {
    user: "他",
    assistant: "凝",
  });
  inserted += r?.inserted ?? 0;
  reinforced += r?.reinforced ?? 0;
  console.log(`  批 ${Math.floor(i / CHUNK) + 1}：新建 ${r?.inserted ?? 0}，加强 ${r?.reinforced ?? 0}`);
}

const after = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
const withView = Number(
  db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND day = ? AND detail LIKE ?").get(day, "%我当时想%")?.c ?? 0,
);
const dayTotal = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND day = ?").get(day)?.c ?? 0);

console.log(`新建 ${inserted}，加强 ${reinforced}`);
console.log(`有效记忆 ${before} → ${after}`);
console.log(`这一天共 ${dayTotal} 条，其中带「我当时想」${withView} 条`);
db.close();
