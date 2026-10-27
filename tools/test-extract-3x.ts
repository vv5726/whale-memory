import { loadBotConfig } from "../src/bot/config.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";
import { buildMessages, parseAndValidate } from "../src/llm/extract.ts";

const cfg = loadBotConfig();
const ad = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);

const turns = [
  { id: "t1", role: "user", text: "我今天发现模型有时返回带代码块的 JSON，解析就整批丢了" },
  { id: "t2", role: "assistant", text: "那就是解析太脆了，剥掉代码块就好" },
];
const msgs = buildMessages("2026-10-26", turns, { user: "他", assistant: "凝" }, []);

for (let i = 0; i < 3; i += 1) {
  const raw = await ad.complete(msgs, { json: true, timeoutMs: 120_000, temperature: 0.3 });
  const r = parseAndValidate(raw, "他");
  const fenced = raw.includes("```");
  console.log(`第${i + 1}次：${fenced ? "带代码块" : "纯 JSON"} → ${r.events.length} 条`);
}
