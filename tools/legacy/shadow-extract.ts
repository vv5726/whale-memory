/**
 * 影子模式：同一段真实对话，新旧两套抽取各跑一次，并排看。
 *
 * 只读：不写 events、不写词库、不写人物库。
 */
import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";
import { buildMessages, parseAndValidate } from "../src/llm/extract.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");
const adapter = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);

// 取一天里的一段真实对话
const day = process.argv[2] ?? "2026-10-26";
const turns = db
  .prepare("SELECT id, role, text, speaker_id FROM turns WHERE day = ? ORDER BY seq DESC LIMIT 30")
  .all(day) as Array<{ id: string; role: string; text: string; speaker_id: string }>;

if (turns.length < 4) {
  console.log(`【${day}】对话太少（${turns.length} 轮）`);
  process.exit(0);
}
turns.reverse();
console.log(`样本：【${day}】${turns.length} 轮\n`);

const names = { user: "他", assistant: "凝" };

// ── 旧版 ──
const oldMsgs = buildMessages(day, turns, names, [], cfg.dataDir ?? "data");
const oldRaw = await adapter.complete(oldMsgs, { json: true, timeoutMs: 120_000, temperature: 0.3 });
const oldParsed = parseAndValidate(oldRaw, names.user);

console.log(`═══ 旧版：${oldParsed.events.length} 条 ═══`);
for (const e of oldParsed.events.slice(0, 4)) {
  console.log(`  【${String(e.title).slice(0, 26)}】`);
  console.log(`    ${String(e.detail).slice(0, 90)}`);
}

// ── 新版：三仓 ──
const newSystem = [
  "你是朋友群的记忆整理器。不要总结聊天，要把聊天记录提炼成「一件件事」。",
  "",
  "一件事 = 主体 + 事件核 + 时间锚 + 状态 + 证据 + 未来用途",
  "标题 = 主体 + 事件核 + 时间锚（例：A和B约定周六下午露营）",
  "",
  "只输出 JSON：",
  '{"events":[{"type":"约定|待办|决策|经历|信息|冲突","title":"...","people":["他"],',
  '"time_absolute":"2026-10-31 15:00 或 空","time_relative":"周六下午 或 空","place":"... 或 空",',
  '"content":"一句话说清楚发生了什么","status":"待确认|已定|已发生|已取消|需跟进|仅记录",',
  '"next_action":"谁该做什么 或 空","evidence":[{"speaker":"他","msg_id":"t_xxx","quote":"原话"}],',
  '"sensitivity":"normal|private|high","memory_value":0到10}],',
  '"lexicon":[{"term":"词或梗","meaning":"它是什么意思","source":"谁说的/哪来的"}],',
  '"persons":[{"qq":"QQ号","note":"关于这个人的偏好/禁忌","strength":0到2}]}',
  "",
  "规则：",
  "1. 同一件事跨多条消息必须合并；不同结果、不同时间、不同人物组合必须拆开。",
  "2. 缺失就写空字符串，不许编造。",
  "3. 相对时间结合消息日期换算，同时保留原话；算不准就留空。",
  "4. events 里的 type 只能是：约定/待办/决策/经历/信息/冲突。",
  "5. 梗、黑话、群规、称呼 → 放进 lexicon，不要放进 events。",
  "6. 某人的偏好、忌口、习惯 → 放进 persons，不要放进 events。",
  "7. 每条 event 至少一条 evidence，msg_id 必须抄消息前的编号。",
  "8. 纯情绪、无对象的感叹、刷屏 → 不记。",
  "9. memory_value 0-10：未来可能被问起 2 分、涉及人或情绪 2 分、有时效会变 2 分、证据明确 2 分、重复出现或状态变化 2 分。",
].join("\n");

const newUser = [
  "聊天记录（每条前面是消息编号）：",
  ...turns.map((t) => `[${t.id}] ${t.speaker_id || (t.role === "user" ? "他" : "凝")}: ${t.text}`),
].join("\n");

const newRaw = await adapter.complete(
  [
    { role: "system", content: newSystem },
    { role: "user", content: newUser },
  ],
  { json: true, timeoutMs: 180_000, temperature: 0.3 },
);

let newJson: { events?: unknown[]; lexicon?: unknown[]; persons?: unknown[] } = {};
try {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(newRaw);
  const body = m?.[1] ?? newRaw;
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  newJson = JSON.parse(body.slice(a, b + 1)) as typeof newJson;
} catch (err) {
  console.log("\n═══ 新版：解析失败 ═══");
  console.log(newRaw.slice(0, 300));
  process.exit(0);
}

console.log("");
console.log(`═══ 新版：事件 ${newJson.events?.length ?? 0} 条，词 ${newJson.lexicon?.length ?? 0} 个，人 ${newJson.persons?.length ?? 0} 条 ═══`);
for (const raw of (newJson.events ?? []).slice(0, 4)) {
  const e = raw as Record<string, unknown>;
  console.log(`  【${String(e.title ?? "").slice(0, 26)}】${String(e.type ?? "")}/${String(e.status ?? "")}　价值 ${String(e.memory_value ?? "")}`);
  console.log(`    ${String(e.content ?? "").slice(0, 80)}`);
  const ev = (e.evidence as Array<{ msg_id?: string }> | undefined)?.[0];
  console.log(`    证据 ${ev?.msg_id ?? "无"}`);
}
for (const raw of (newJson.lexicon ?? []).slice(0, 3)) {
  const l = raw as Record<string, unknown>;
  console.log(`  〔词〕${String(l.term ?? "")} = ${String(l.meaning ?? "").slice(0, 40)}`);
}
for (const raw of (newJson.persons ?? []).slice(0, 3)) {
  const p = raw as Record<string, unknown>;
  console.log(`  〔人〕${String(p.qq ?? "")}：${String(p.note ?? "").slice(0, 40)}`);
}

db.close();
