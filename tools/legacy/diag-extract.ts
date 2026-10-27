/**
 * 抽取自检：把关卡一层层打出来，看在哪断的。
 *
 * 每一层都打印，不在任何一层做猜测。
 */
import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { loadAnchorIndex } from "../src/anchors.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";
import { buildMessages, extractDayWithLlm, parseAndValidate } from "../src/llm/extract.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");
const line = (n: string, ok: boolean, detail = ""): void =>
  console.log(`  ${ok ? "✓" : "✗"} ${n}${detail ? ` — ${detail}` : ""}`);

// ── 第 0 层：有没有待整理的对话 ──
const pending = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get() as { c: number };
console.log(`\n【0】待整理对话：${pending.c} 轮`);

const today = new Date().toISOString().slice(0, 10);
const turns = db
  .prepare("SELECT id, role, text, speaker_id FROM turns ORDER BY seq DESC LIMIT 12")
  .all() as Array<{ id: string; role: string; text: string; speaker_id: string }>;

console.log(`【1】拿最近 ${turns.length} 轮做样本（从库里取，不伪造）`);
if (turns.length === 0) {
  console.log("  库里没有对话，无法自检");
  process.exit(0);
}

const payload = turns
  .reverse()
  .filter((t) => String(t.text ?? "").trim().length > 0)
  .map((t) => ({ id: t.id, role: t.role, text: t.text, speakerId: t.speaker_id }));

line("样本可用", payload.length >= 2, `${payload.length} 轮`);

// ── 第 2 层：提示词里到底有没有 my_view ──
const msgs = buildMessages(today, payload, { user: "他", assistant: "凝" }, []);
const systemText = msgs.map((m) => String(m.content ?? "")).join("\n");
line("提示词含 my_view", systemText.includes("my_view"));
line("提示词含「我当时怎么想」", systemText.includes("我当时怎么想"));

// ── 第 3 层：模型原样返回了什么 ──
const adapter = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);
let raw = "";
try {
  raw = await adapter.complete(msgs, { json: true, timeoutMs: 120_000, temperature: 0.3 });
  line("模型有返回", raw.length > 0, `${raw.length} 字`);
} catch (err) {
  line("模型有返回", false, err instanceof Error ? err.message : String(err));
  process.exit(1);
}

line("返回里有 my_view 字段", raw.includes("my_view"));

// ── 第 4 层：解析出几条 ──
const parsed = parseAndValidate(raw, "他");
line("解析出事件", parsed.events.length > 0, `${parsed.events.length} 条，拒绝 ${parsed.rejected} 条`);
const withView = parsed.events.filter((e) => String(e.detail).includes("〔我当时想："));
line("带「我当时想」", withView.length > 0, `${withView.length}/${parsed.events.length} 条`);

for (const e of parsed.events.slice(0, 3)) {
  console.log(`     · ${String(e.title).slice(0, 30)}`);
  console.log(`       ${String(e.detail).slice(0, 110)}`);
}

// ── 第 5 层：走完整函数（含缓存）会怎样 ──
db.prepare("DELETE FROM llm_extractions").run();
const index = loadAnchorIndex(db);
const out = await extractDayWithLlm(db, cfg, index, adapter, today, payload, {
  user: "他",
  assistant: "凝",
});
line("extractDayWithLlm 有产出", (out?.inserted ?? 0) + (out?.reinforced ?? 0) > 0, `新建 ${out?.inserted ?? 0} 条、加强 ${out?.reinforced ?? 0} 条、拒绝 ${out?.rejected ?? 0} 条`);
if (out && (out as { error?: string }).error) console.log(`       错误：${(out as { error?: string }).error}`);

db.close();
