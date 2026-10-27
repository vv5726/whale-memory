import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { recall } from "../src/recall.ts";
import { DEFAULT_CONFIG, withOverrides } from "../src/config.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");

const rows = db.prepare("SELECT role, text FROM turns ORDER BY seq DESC LIMIT 6").all() as Array<{
  role: string;
  text: string;
}>;
console.log("最近 6 条：");
for (const r of rows.reverse()) {
  console.log(`  ${r.role === "user" ? "他" : "凝"}：${String(r.text).replace(/\s+/g, " ").slice(0, 60)}`);
}

const last = rows.find((r) => r.role === "user")?.text ?? "";
console.log("");
console.log(`拿最后一句试：「${String(last).slice(0, 40)}」`);

const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });
const g = (svc as unknown as { asksAboutPast: (t: string) => boolean }).asksAboutPast(String(last));
console.log(`  asksAboutPast = ${g}（true 才会走防幻觉检查）`);

const memoryCfg = withOverrides(DEFAULT_CONFIG, {
  contextBudgetTokens: cfg.contextBudgetTokens,
  extractor: cfg.useLlmExtractor ? "llm" : "heuristic",
  llmBaseUrl: cfg.ollamaBaseUrl,
  llmModel: cfg.ollamaModel,
});
const m = recall(db, memoryCfg, String(last), { sessionId: "diag" });
console.log(`  检索：seeds=${m.seeds.length} factual=${m.factual.length} 最高分=${(m.factual[0]?.breakdown.total ?? 0).toFixed(2)}`);
console.log(`  判弱（记忆不够）= ${(svc as unknown as { isWeak: (m: unknown) => boolean }).isWeak(m)}`);

svc.close();
db.close();
