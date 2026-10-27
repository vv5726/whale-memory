import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { loadAnchorIndex } from "../src/anchors.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";
import { extractDayV3 } from "../src/llm/extract-v3.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");
const adapter = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);
const index = loadAnchorIndex(db);

const turns = (db.prepare("SELECT id, role, text, speaker_id FROM turns WHERE day = '2026-10-26' ORDER BY seq DESC LIMIT 6").all() as Array<{
  id: string;
  role: string;
  text: string;
  speaker_id: string;
}>).reverse();

try {
  const r = await extractDayV3(
    db,
    cfg as never,
    index,
    adapter,
    "2026-10-26",
    turns.map((t) => ({ id: t.id, role: t.role, text: t.text, speakerId: t.speaker_id })),
    { user: "他", assistant: "凝" },
  );
  console.log("结果：" + JSON.stringify(r));
} catch (err) {
  console.log("失败：" + (err instanceof Error ? err.message : String(err)));
  console.log(String((err as Error)?.stack ?? "").split("\n").slice(0, 8).join("\n"));
}
db.close();
