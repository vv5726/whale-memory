import { readFileSync, writeFileSync } from "node:fs";

// ① think：想到一个锚点时，把知识库里相关的也带出来
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");

  const old = `    if (anchor.related && anchor.related.length > 0) {`;
  if (s.includes(old) && !s.includes("kbForAnchor")) {
    s = s.replace(
      old,
      `    // 知识库：读到过的、跟这个锚点有关的东西。
    // 之前知识库存了但从来没被想起过——读了一堆论文，用的时候一条都想不起来。
    try {
      const names = [anchor.name, ...(anchor.related ?? []).map((r) => r.name)];
      const seen = new Set<string>();
      const hits: Array<{ category: string; title: string; content: string }> = [];
      for (const n of names) {
        for (const e of searchKnowledge(this.cfg.dataDir, n, 2)) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          hits.push({ category: e.category, title: e.title, content: e.content });
        }
      }
      if (hits.length > 0) {
        lines.push("【你读过的、跟这有关的】");
        for (const h of hits.slice(0, 4)) {
          lines.push(\`- 〔\${h.category}〕\${h.title}：\${h.content.replace(/\\s+/g, " ").slice(0, 120)}\`);
        }
        lines.push("");
      }
    } catch {
      // 知识库读不出来不影响走神
    }

    if (anchor.related && anchor.related.length > 0) {`,
    );
    writeFileSync(p, s, "utf8");
    console.log("think：知识库已接");
  }
}

// ② 聊天：检索时也带两条知识库
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("kbHits")) {
    s = s.replace(
      "      terms: matchTerms(this.cfg.dataDir, text),",
      [
        "      terms: matchTerms(this.cfg.dataDir, text),",
        "      kbHits: (() => {",
        "        try {",
        "          return searchKnowledge(this.cfg.dataDir, text, 2).map((e) => ({",
        "            category: e.category,",
        "            title: e.title,",
        "            content: e.content,",
        "          }));",
        "        } catch {",
        "          return [];",
        "        }",
        "      })(),",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("聊天：知识库已接");
  }
}

// ③ persona：把知识库那段渲染出来
{
  const p = "src/bot/persona.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("input.kbHits")) {
    s = s.replace(
      "    uptime?: string;",
      [
        "    uptime?: string;",
        "    /** 知识库里跟这句话相关的 */",
        "    kbHits?: Array<{ category: string; title: string; content: string }>;",
      ].join("\n"),
    );
    s = s.replace(
      "  if (input.term && input.terms.length > 0) {".replace("term && ", ""),
      [
        "  if (input.kbHits && input.kbHits.length > 0) {",
        '    parts.push("【你读过的东西】");',
        "    for (const k of input.kbHits) {",
        '      parts.push(`- 〔${k.category}〕${k.title}：${String(k.content).replace(/\\s+/g, " ").slice(0, 120)}`);',
        "    }",
        "  }",
        "",
        "  if (input.terms && input.terms.length > 0) {",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("persona：知识库段已加");
  }
}
