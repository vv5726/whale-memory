import { readFileSync, writeFileSync } from "node:fs";

// 1) config：0 表示不限
{
  const p = "src/bot/config.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace(
    "  /** 每天最多主动说几次 */\n  proactiveDailyLimit: number;",
    "  /** 每天最多主动说几次；0 表示不限 */\n  proactiveDailyLimit: number;",
  );
  s = s.replace("  proactiveDailyLimit: 4,", "  proactiveDailyLimit: 0,");
  writeFileSync(p, s, "utf8");
  console.log("config: 额度改为不限");
}

// 2) autonomy：limit<=0 时不拦
{
  const p = "src/bot/autonomy.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace(
    "    const used = this.service.proactiveUsedToday();\n    if (used >= cfg.proactiveDailyLimit) {\n      return { spoke: false, reason: `今天已主动说过 ${used} 次，够了` };\n    }",
    [
      "    const used = this.service.proactiveUsedToday();",
      "    // proactiveDailyLimit = 0 表示不限；否则到数就闭嘴",
      "    if (cfg.proactiveDailyLimit > 0 && used >= cfg.proactiveDailyLimit) {",
      "      return { spoke: false, reason: `今天已主动说过 ${used} 次，够了` };",
      "    }",
    ].join("\n"),
  );
  writeFileSync(p, s, "utf8");
  console.log("autonomy: 不限额");
}

// 3) service：提示词里把上限说清楚
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace(
    "        `你今天已经主动找过他 ${info.used} 次（上限 ${info.limit} 次）。`,",
    "        info.limit > 0\n          ? `你今天已经主动找过他 ${info.used} 次（上限 ${info.limit} 次）。`\n          : `你今天已经主动找过他 ${info.used} 次，没有次数限制。`,",
  );
  writeFileSync(p, s, "utf8");
  console.log("service: 提示词已改");
}
