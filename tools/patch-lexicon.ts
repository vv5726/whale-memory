import { readFileSync, writeFileSync } from "node:fs";

// ① service：每轮匹配词库，命中就带给提示词
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("matchTerms")) {
    s = s.replace(
      'import { describeCqCodes } from "../cqcode.ts";',
      'import { describeCqCodes } from "../cqcode.ts";\nimport { learnTerm, matchTerms } from "../lexicon.ts";',
    );
    s = s.replace(
      "      alwaysOn: this.alwaysOnMemories(),",
      [
        "      alwaysOn: this.alwaysOnMemories(),",
        "      terms: matchTerms(this.cfg.dataDir, text),",
      ].join("\n"),
    );
    // 学词的方法
    s = s.replace(
      "  /** 每轮现算的真实数字",
      [
        "  /** 学一个新词（梗、黑话、口头禅），下次遇到就带释义 */",
        "  learnTerm(term: string, meaning: string): boolean {",
        "    try {",
        "      return learnTerm(this.cfg.dataDir, term, meaning, \"学到的\");",
        "    } catch {",
        "      return false;",
        "    }",
        "  }",
        "",
        "  /** 每轮现算的真实数字",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("service：词库已接");
  }
}

// ② persona：命中词条的释义放进提示词
{
  const p = "src/bot/persona.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("input.terms")) {
    s = s.replace(
      "    alwaysOn?: Array<{ kind: string; text: string }>;",
      [
        "    alwaysOn?: Array<{ kind: string; text: string }>;",
        "    /** 这句话里出现的梗/黑话，带释义 */",
        "    terms?: Array<{ term: string; meaning: string }>;",
      ].join("\n"),
    );
    s = s.replace(
      '  parts.push(`现在跟你说话的是「${input.userName}」。上面每句话前面的名字，就是谁说的。`);',
      [
        '  parts.push(`现在跟你说话的是「${input.userName}」。上面每句话前面的名字，就是谁说的。`);',
        "",
        "  if (input.terms && input.terms.length > 0) {",
        '    parts.push("【这些话里的词】");',
        "    for (const t of input.terms) parts.push(`- 「${t.term}」= ${t.meaning}`);",
        "  }",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("persona：词条注入已接");
  }
}
