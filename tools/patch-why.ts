import { readFileSync, writeFileSync } from "node:fs";

// ① recall 返回时带上打分细节
{
  const p = "src/recall.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("scored:")) {
    // 找到 return 里 factual 那行，在后面加 scored
    s = s.replace(
      "    factual,\n",
      [
        "    factual,",
        "    // 排序视野：每条的分是怎么来的，给它自己看",
        "    scored: (kept as Array<{ event: EventRow; breakdown?: Record<string, number> }>).slice(0, 8).map((c) => ({",
        "      title: String(c.event.title ?? \"\").slice(0, 40),",
        "      score: Number((c.breakdown as { total?: number } | undefined)?.total ?? 0),",
        "      evidence: Number(c.breakdown?.evidence ?? 0),",
        "      anchor: Number(c.breakdown?.anchorEvidence ?? 0),",
        "      feeling: Number(c.breakdown?.arousalBonus ?? 0),",
        "      strength: Number(c.event.strength ?? 1),",
        "      mentions: Number(c.event.mentions ?? 1),",
        "      pinned: Boolean(c.event.pinned),",
        "      tier: String(c.event.tier ?? \"\"),",
        "    })),",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("recall：scored 已加");
  }
}

// ② memory_recall 工具：把分数打出来
{
  const p = "src/tools/selfmemory.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("排序视野")) {
    s = s.replace(
      "  registry.register(about);",
      [
        "  registry.register(about);",
        "",
        "  // ── 排序视野：这次为什么是这几条 ──",
        "  const why: ToolDefinition = {",
        '    name: "memory_why",',
        '    description:',
        '      "看这次检索的排序明细：每条多少分、分从哪来（锚点证据/情绪/钉住/强度）。想知道「为什么是这几条」「为什么某条排不上」，用它。",',
        "    parameters: {",
        '      type: "object",',
        '      properties: { query: { type: "string", description: "拿什么问题试（不给就用「最近的事」）" } },',
        "    },",
        "    handler: async (args) => {",
        "      if (!hooks.why) return { ok: false, text: \"现在看不了\" };",
        '      const rows = hooks.why(String(args.query ?? ""));',
        "      if (rows.length === 0) return { ok: true, text: \"这次什么都没捞到\" };",
        "      const lines = rows.map((r, i) =>",
        "        `${i + 1}. ${r.title}\\n   总 ${r.score.toFixed(2)}＝证据 ${r.evidence.toFixed(2)}(锚点 ${r.anchor.toFixed(2)} 情绪 ${r.feeling.toFixed(2)})｜强度 ${r.strength}×提到 ${r.mentions}｜${r.pinned ? \"钉住\" : \"没钉\"}｜${r.tier}`,",
        "      );",
        "      return { ok: true, text: [\"排序视野（这次为什么是这几条）：\", ...lines].join(\"\\n\") };",
        "    },",
        "  };",
        "  registry.register(why);",
      ].join("\n"),
    );
    // hooks 加 why
    s = s.replace(
      "    /** 它自己想整理一次记忆（等于睡一觉） */",
      [
        "    /** 排序视野：拿一个问题试，看每条的分 */",
        "    why?: (query: string) => Array<{",
        "      title: string;",
        "      score: number;",
        "      evidence: number;",
        "      anchor: number;",
        "      feeling: number;",
        "      strength: number;",
        "      mentions: number;",
        "      pinned: boolean;",
        "      tier: string;",
        "    }>;",
        "    /** 它自己想整理一次记忆（等于睡一觉） */",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("memory_why 工具已加");
  }
}
