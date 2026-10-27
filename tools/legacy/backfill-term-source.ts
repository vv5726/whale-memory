import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadBotConfig } from "../src/bot/config.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";
import { loadLexicon } from "../src/lexicon.ts";
import { listPeople } from "../src/people.ts";
import { openDb } from "../src/db.ts";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-termsrc-${ts}`);
mkdirSync(dir, { recursive: true });
for (const f of ["src/lexicon.ts", "src/tools/selfmemory.ts", "data/lexicon.json"]) {
  try {
    copyFileSync(f, join(dir, f.replace(/[\\/]/g, "_")));
  } catch {
    /* 跳过 */
  }
}
console.log(`① 备份 → ${dir}`);

// ② learnTerm 支持「谁说的」（必须是人锚点里的人）
{
  const p = "src/lexicon.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("saidBy")) {
    s = s.replace(
      "export function learnTerm(",
      "export function learnTerm(",
    );
    s = s.replace(
      /export function learnTerm\(([^)]*)\)/,
      "export function learnTerm($1, saidBy?: { qq: string; name: string })",
    );
    s = s.replace(
      "  lex[term] = {",
      "  (entry as { anchors?: string[] }).anchors = saidBy ? [saidBy.qq] : [];\n  lex[term] = {",
    );
    writeFileSync(p, s, "utf8");
    console.log("② learnTerm 支持 saidBy");
  } else console.log("② 已有");
}

// ③ 补来源：一次模型调用，从「已有的人」里选，选不出就留未记录
const cfg = loadBotConfig();
const db = openDb("data/memory.db");
const people = listPeople(db);
const lex = loadLexicon("data");
const terms = Object.values(lex).map((t) => ({ term: t.term, meaning: t.meaning }));

console.log(`③ 给 ${terms.length} 个词补来源（候选 ${people.length} 人）`);

const prompt = [
  "下面是一些聊天里学到的词/梗，要判断每个词「最早是谁说的/谁起的」。",
  "",
  "只能从这份名单里选（用 QQ 号）：",
  ...people.filter((p) => p.name).map((p) => `  ${p.qqId} = ${p.name}`),
  "",
  "词表：",
  ...terms.map((t) => `  ${t.term}：${String(t.meaning).slice(0, 40)}`),
  "",
  '只输出 JSON：{"assign":[{"term":"词","qq":"QQ号或空字符串","why":"一句话"}]}',
  "判断不了就填空字符串，不要硬猜。",
].join("\n");

const adapter = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);
let assigned = 0;
try {
  const raw = await adapter.complete([{ role: "user", content: prompt }], { json: true, timeoutMs: 120_000, temperature: 0 });
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = m?.[1] ?? raw;
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  const parsed = JSON.parse(body.slice(a, b + 1)) as { assign?: Array<{ term?: string; qq?: string; why?: string }> };
  const valid = new Set(people.map((p) => p.qqId));
  const { attachTermAnchors } = await import("../src/lexicon.ts");
  for (const it of parsed.assign ?? []) {
    const term = String(it.term ?? "").trim();
    const qq = String(it.qq ?? "").trim();
    if (!term || !valid.has(qq)) continue;
    attachTermAnchors("data", term, [qq]);
    assigned += 1;
  }
  console.log(`   挂上 ${assigned} 个`);
} catch (err) {
  console.log("   模型调用失败：" + (err instanceof Error ? err.message : String(err)));
}

const after = loadLexicon("data");
const withA = Object.values(after).filter((t) => ((t as { anchors?: string[] }).anchors ?? []).length > 0).length;
console.log(`④ 现在有锚点的词：${withA} / ${Object.keys(after).length}`);
db.close();
