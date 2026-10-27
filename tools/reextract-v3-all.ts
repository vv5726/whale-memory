/**
 * 用 v3 把老对话重新抽一遍，长出真正的「事」锚点。
 *
 * 只新增，不修改老记忆；老的那些标着 legacy 摆着。
 * 分批：每天每 60 轮一次，进度打日志。
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { loadAnchorIndex } from "../src/anchors.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";
import { extractDayV3 } from "../src/llm/extract-v3.ts";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-v3all-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("data/memory.db", join(dir, "memory.db"));
console.log(`备份 → ${dir}/memory.db`);

const cfg = loadBotConfig();
const db = openDb("data/memory.db");
const adapter = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);
const index = loadAnchorIndex(db);

const days = db.prepare("SELECT day, COUNT(*) AS c FROM turns GROUP BY day ORDER BY day").all() as Array<{
  day: string;
  c: number;
}>;

let totalInserted = 0;
const CHUNK = 60;

for (const d of days) {
  const turns = db
    .prepare("SELECT id, role, text, speaker_id FROM turns WHERE day = ? ORDER BY seq")
    .all(d.day) as Array<{ id: string; role: string; text: string; speaker_id: string }>;

  console.log(`\n【${d.day}】${turns.length} 轮`);
  for (let i = 0; i < turns.length; i += CHUNK) {
    const chunk = turns.slice(i, i + CHUNK).map((t) => ({
      id: t.id,
      role: t.role,
      text: t.text,
      speakerId: t.speaker_id,
    }));
    try {
      const r = await extractDayV3(db, cfg as never, index, adapter, d.day, chunk, {
        user: "他",
        assistant: "凝",
      });
      totalInserted += r.inserted;
      console.log(`  批 ${Math.floor(i / CHUNK) + 1}：+${r.inserted} 条（累计 ${totalInserted}）`);
    } catch (err) {
      console.log(`  批 ${Math.floor(i / CHUNK) + 1} 失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

const typed = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE etype <> ''").get()?.c ?? 0);
const evAnchors = Number(db.prepare("SELECT COUNT(*) AS c FROM anchors WHERE kind = 'event'").get()?.c ?? 0);
const links = Number(db.prepare("SELECT COUNT(*) AS c FROM event_anchors").get()?.c ?? 0);
const edges = Number(db.prepare("SELECT COUNT(*) AS c FROM edges").get()?.c ?? 0);

console.log("");
console.log("═══ 完成 ═══");
console.log(`新抽 ${totalInserted} 条｜带 etype 的记忆 ${typed} 条`);
console.log(`事锚点 ${evAnchors} 个｜挂载 ${links}｜边 ${edges}`);
db.close();
