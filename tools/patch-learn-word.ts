import { readFileSync, writeFileSync } from "node:fs";

// ── ① 工具：learn_word —— 遇到不懂的词就记下来，或者问人 ──
{
  const p = "src/tools/selfmemory.ts";
  let s = readFileSync(p, "utf8");

  if (!s.includes("learn_word")) {
    const anchor = "  registry.register(byDay);";
    const block = [
      "  registry.register(byDay);",
      "",
      "  // ── 学词：梗、黑话、口头禅 ──",
      "  const learnWord: ToolDefinition = {",
      '    name: "learn_word",',
      '    description:',
      '      "遇到不懂的词（梗、黑话、口头禅、缩写）。要么传 meaning 直接记下来（你查到了或者对方解释过），要么只传 term 就会告诉你「不认识」——这时候去问对方。",',
      "    parameters: {",
      '      type: "object",',
      "      properties: {",
      '        term: { type: "string", description: "那个词本身" },',
      '        meaning: { type: "string", description: "它是什么意思；不知道就别传" },',
      "      },",
      '      required: ["term"],',
      "    },",
      "    handler: async (args) => {",
      '      const term = String(args.term ?? "").trim();',
      '      const meaning = String(args.meaning ?? "").trim();',
      '      if (term.length === 0) return { ok: false, text: "没说要学哪个词" };',
      "",
      "      if (!hooks.learn) return { ok: false, text: \"现在记不了\" };",
      "",
      "      if (meaning.length === 0) {",
      "        // 只问不学：看看词库里有没有",
      '        const known = db.prepare("SELECT 1").get() ? hooks.lookup?.(term) : undefined;',
      "        if (known) return { ok: true, text: `「${term}」= ${known}` };",
      "        return { ok: true, text: `「${term}」我不认识。可以去问对方这是啥意思，问清了再用 learn_word 记下来。` };",
      "      }",
      "",
      "      const ok = hooks.learn(term, meaning);",
      "      return { ok, text: ok ? `记下了：「${term}」= ${meaning}` : \"没记上（可能已经有了）\" };",
      "    },",
      "  };",
      "  registry.register(learnWord);",
    ].join("\n");

    s = s.replace(anchor, block);

    // hooks 加 learn / lookup
    s = s.replace(
      "    /** 它自己想整理一次记忆（等于睡一觉） */",
      [
        "    /** 学一个词，记进词库 */",
        "    learn?: (term: string, meaning: string) => boolean;",
        "    /** 查一个词认不认识 */",
        "    lookup?: (term: string) => string | undefined;",
        "    /** 它自己想整理一次记忆（等于睡一觉） */",
      ].join("\n"),
    );

    writeFileSync(p, s, "utf8");
    console.log("learn_word 已加");
  }
}

// ── ② service：把 hooks 接上 ──
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("lookup:")) {
    s = s.replace(
      "          tidy: async () => {",
      [
        "          learn: (term, meaning) => learnTerm(this.cfg.dataDir, term, meaning, \"学到的\"),",
        "          lookup: (term) => matchTerms(this.cfg.dataDir, term).find((t) => t.term === term)?.meaning,",
        "          tidy: async () => {",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("service：learn/lookup 已接");
  }
}

// ── ③ 提示词：告诉它不懂就问 ──
{
  const p = "src/bot/persona.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("learn_word")) {
    s = s.replace(
      '      "想不起某一天聊了什么，用 memory_day 按日期翻（比如 day=2026-10-25）。",',
      [
        '      "想不起某一天聊了什么，用 memory_day 按日期翻（比如 day=2026-10-25）。",',
        '      "遇到不懂的词（梗、黑话、缩写），用 learn_word 查；查不到就问对方——别装懂，装懂一次后面全错。",',
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("persona：learn_word 提示已加");
  }
}
