import { readFileSync, writeFileSync } from "node:fs";

// ① 抽取提示词：多一个「我当时怎么想」
{
  const p = "src/llm/extract.ts";
  let s = readFileSync(p, "utf8");

  if (!s.includes("my_view")) {
    // JSON 模板加字段
    s = s.replace(
      '"promise":{"isPromised":',
      '"my_view":"我当时怎么想的：重要吗、同意吗、打算怎么办（没有就 null）",\n"promise":{"isPromised":',
    );

    // 规则加一条
    s = s.replace(
      '    "13. **不要记「对话本身」的元叙述。**',
      [
        '    "13. **每条记忆都要带上「我当时怎么想」。**",',
        '    "   现在的记忆全是「他说了什么」，攒一堆日程，没有我。",',
        '    "   my_view 写你当时真实的反应：觉得重要/不重要、同意/不同意、打算怎么办、想说但没说的。",',
        '    "   要有具体判断，不要「我认为这很重要」这种废话。没有真实想法就填 null，别硬编。",',
        '    "14. **不要记「对话本身」的元叙述。**',
      ].join("\n"),
    );

    // 解析出 my_view 并拼进正文
    s = s.replace(
      "        detail: str(d.detail, 400),",
      [
        "        detail: (() => {",
        "          const base = str(d.detail, 400);",
        '          const view = str((d as { my_view?: unknown }).my_view, 120);',
        "          if (!view || view === \"null\") return base;",
        '          return `${base}〔我当时想：${view}〕`;',
        "        })(),",
      ].join("\n"),
    );

    writeFileSync(p, s, "utf8");
    console.log("抽取：my_view 已加");
  }
}

// ② 抽取温度可调（默认 0.3，比 0 有变化但不飘）
{
  const p = "src/llm/extract.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace(
    "raw = await adapter.complete(messages, { json: true, timeoutMs: cfg.llmTimeoutMs });",
    "raw = await adapter.complete(messages, {\n        json: true,\n        timeoutMs: cfg.llmTimeoutMs,\n        temperature: cfg.extractTemperature ?? 0.3,\n      });",
  );
  writeFileSync(p, s, "utf8");
  console.log("抽取：温度可调");
}

// ③ config 加字段
{
  const p = "src/config.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("extractTemperature")) {
    s = s.replace("  factTopK: 5,", "  factTopK: 5,\n  /** 抽取时的温度：0 完全一致（会写成模板），0.3 有变化但不飘 */\n  extractTemperature: 0.3,");
    writeFileSync(p, s, "utf8");
    console.log("config：extractTemperature 已加");
  }
}
