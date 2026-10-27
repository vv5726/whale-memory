import { readFileSync, writeFileSync } from "node:fs";

// ── config：预算字段 ──
{
  const p = "src/bot/config.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("dailyBudgetYuan")) {
    s = s.replace(
      "  /** 所有人共用一个记忆库（data/memory.db），而不是每人一个 */",
      [
        "  /** 每天最多花多少钱（元）；0 表示不限。这是唯一还拦着她的东西 */",
        "  dailyBudgetYuan: number;",
        "  /** 每百万输入 token 多少钱 */",
        "  costInputPerMTok: number;",
        "  /** 每百万输出 token 多少钱 */",
        "  costOutputPerMTok: number;",
        "  /** 所有人共用一个记忆库（data/memory.db），而不是每人一个 */",
      ].join("\n"),
    );
    s = s.replace(
      "  sharedMemory: true,",
      ["  dailyBudgetYuan: 5,", "  costInputPerMTok: 2,", "  costOutputPerMTok: 8,", "  sharedMemory: true,"].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("config：预算字段已加");
  }
}

// ── service：初始化记账 + 花超了就停 ──
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("initCost")) {
    s = s.replace(
      'import { recordOwnNote } from "../notes.ts";',
      'import { recordOwnNote } from "../notes.ts";\nimport { initCost, todayCost } from "../cost.ts";',
    );
    // 构造时初始化
    s = s.replace(
      "    this.tools = cfg.toolsEnabled ? buildTools(cfg, this.db) : null;",
      [
        "    this.tools = cfg.toolsEnabled ? buildTools(cfg, this.db, opts.notify) : null;",
        "    initCost(this.db, {",
        "      inputPerMTok: cfg.costInputPerMTok,",
        "      outputPerMTok: cfg.costOutputPerMTok,",
        "      dailyBudgetYuan: cfg.dailyBudgetYuan,",
        "    });",
      ].join("\n"),
    );
    // respond 里先查预算
    s = s.replace(
      "  ): Promise<{ text: string; toolText: string }> {\n    if (this.tools && this.cfg.provider === \"deepseek\") {",
      [
        "  ): Promise<{ text: string; toolText: string }> {",
        "    // 钱是唯一还在拦它的东西：超预算今天就不调模型了",
        "    const cost = todayCost();",
        "    if (cost.exhausted) {",
        '      return { text: `今天的额度用完了（${cost.budgetYuan} 块，已花 ${cost.yuan} 块）。明天再说。`, toolText: "" };',
        "    }",
        "",
        '    if (this.tools && this.cfg.provider === "deepseek") {',
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("service：预算拦截已加");
  }
}
