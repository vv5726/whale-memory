import { buildMessages, extractDayWithLlm } from "../src/llm/extract.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";
import { openDb } from "../src/db.ts";
import { ensurePerson } from "../src/people.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");

// 确保主人的人节点在，名字是「林溪」
const person = ensurePerson(db, 10001, "林溪");
console.log(`主人 → QQ ${person?.qqId}，名字 ${person?.displayName}`);

const turns = [
  { role: "user", text: "你别这么直男发言" },
  { role: "assistant", text: "行，那我收着点。" },
  { role: "user", text: "笑是什么？他说的笑是指开心，不是嘲笑" },
];

const msgs = buildMessages("2026-10-25", turns, { user: "林溪", assistant: "凝" }, []);
console.log("\n=== 对话渲染（看有没有用真名）===");
const userMsg = String(msgs[1]?.content ?? "");
console.log(userMsg.split("\n").filter((l) => l.includes("：")).slice(0, 5).join("\n"));

console.log("\n=== 抽取出来的记忆（看还有没有代词）===");
const adapter = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);
const raw = await adapter.complete(msgs, { json: true, timeoutMs: 120_000 });

const parsed = JSON.parse(raw) as { events?: Array<{ title: string; detail: string }> };
for (const e of parsed.events ?? []) {
  const bad = /对方|本人|他说|她说|你说的/.test(`${e.title}${e.detail}`) ? " ⚠️ 还有代词" : "";
  console.log(`- ${e.title}${bad}`);
  console.log(`    ${String(e.detail).slice(0, 90)}`);
}
db.close();
