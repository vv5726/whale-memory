import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-lexicon-${ts}`);
mkdirSync(dir, { recursive: true });
for (const f of ["src/lexicon.ts", "src/bot/service.ts", "data/lexicon.json"]) {
  try {
    copyFileSync(f, join(dir, f.replace(/[\\/]/g, "_")));
  } catch {
    /* 可能不存在 */
  }
}
console.log(`① 备份 → ${dir}`);

// ② 词条加 anchors 字段 + 按锚点查词
{
  const p = "src/lexicon.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("termsForAnchors")) {
    s = s.replace(
      "export interface Term",
      "export interface Term",
    );
    // 在文件末尾追加：按锚点查词 + 给词挂锚点
    s += `

/** 想到这些锚点时，该想起哪些词 */
export function termsForAnchors(dataDir: string, anchorNames: string[], limit = 4): Term[] {
  const lex = loadLexicon(dataDir);
  const names = anchorNames.filter(Boolean);
  if (names.length === 0) return [];
  const out: Term[] = [];
  for (const t of Object.values(lex)) {
    const as = (t as Term & { anchors?: string[] }).anchors ?? [];
    if (as.some((a) => names.includes(a))) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** 给一个词挂锚点（来源是谁就挂谁） */
export function attachTermAnchors(dataDir: string, term: string, anchors: string[]): void {
  const lex = loadLexicon(dataDir);
  const t = lex[term] as (Term & { anchors?: string[] }) | undefined;
  if (!t) return;
  const cur = new Set(t.anchors ?? []);
  for (const a of anchors) if (a) cur.add(a);
  t.anchors = [...cur];
  saveLexicon(dataDir, lex);
}
`;
    writeFileSync(p, s, "utf8");
    console.log("② lexicon 加了 termsForAnchors / attachTermAnchors");
  } else console.log("② 已有");
}

// ③ 走神时把词也带出来
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("termsForAnchors")) {
    s = s.replace(
      'import { learnTerm, matchTerms } from "../lexicon.ts";',
      'import { attachTermAnchors, learnTerm, matchTerms, termsForAnchors } from "../lexicon.ts";',
    );
    s = s.replace(
      '        lines.push("");\n      }\n    } catch {\n      // 知识库读不出来不影响走神',
      [
        '        lines.push("");',
        "      }",
        '      // 词库：想到这个锚点时，也想起跟它有关的词（梗、称呼、黑话）',
        "      const terms = termsForAnchors(this.cfg.dataDir, names, 3);",
        "      if (terms.length > 0) {",
        '        lines.push("【跟这个有关的词】");',
        "        for (const t of terms) lines.push(`- ${t.term}：${String(t.meaning).slice(0, 60)}`);",
        '        lines.push("");',
        "      }",
        "    } catch {",
        "      // 知识库/词库读不出来不影响走神",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("③ 走神已接词库");
  } else console.log("③ 已有");
}

// ④ 给已有词条补锚点：从 meaning/source 里认人和群号
const { loadLexicon, attachTermAnchors } = await import("../src/lexicon.ts");
const { listPeople } = await import("../src/people.ts");
const { openDb } = await import("../src/db.ts");
const db = openDb("data/memory.db");

const people = listPeople(db);
const lex = loadLexicon("data");
let attached = 0;
for (const t of Object.values(lex)) {
  const blob = `${t.term} ${t.meaning} ${t.source ?? ""}`;
  const hits: string[] = [];
  for (const p of people) {
    if (p.name && p.name.length >= 2 && blob.includes(p.name)) hits.push(p.qqId);
    for (const a of p.aliases ?? []) {
      if (a.length >= 2 && blob.includes(a)) hits.push(p.qqId);
    }
  }
  if (hits.length > 0) {
    attachTermAnchors("data", t.term, [...new Set(hits)]);
    attached += 1;
  }
}
console.log(`④ ${attached} 个词挂上了人锚点（共 ${Object.keys(lex).length} 个词）`);

const after = loadLexicon("data");
const withA = Object.values(after).filter((t) => ((t as { anchors?: string[] }).anchors ?? []).length > 0).length;
console.log(`   现在有锚点的词：${withA} 个`);
db.close();
