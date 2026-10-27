import { readFileSync, writeFileSync } from "node:fs";

// ── 1) config 新增主动说话相关字段 ──
{
  const p = "src/bot/config.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("proactiveEnabled")) {
    s = s.replace(
      "  /** 每天最多自主活动几轮 */\n  autonomyDailyRounds: number;",
      [
        "  /** 每天最多自主活动几轮 */",
        "  autonomyDailyRounds: number;",
        "  /** 会不会主动找他说话（不是回复，是自己开口） */",
        "  proactiveEnabled: boolean;",
        "  /** 每天最多主动说几次 */",
        "  proactiveDailyLimit: number;",
        "  /** 他多久没说话之后才允许主动开口（分钟） */",
        "  proactiveIdleMinutes: number;",
      ].join("\n"),
    );
    s = s.replace(
      "  autonomyDailyRounds: 24,",
      "  autonomyDailyRounds: 24,\n  proactiveEnabled: true,\n  proactiveDailyLimit: 4,\n  proactiveIdleMinutes: 45,",
    );
    writeFileSync(p, s, "utf8");
    console.log("config: 主动说话字段已加");
  }
}

// ── 2) service：主动开口的能力 ──
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("speakUp(")) {
    const marker = "  /** 把一条笔记直接写进记忆";
    const block = [
      "  /** 今天已经主动说了几次 */",
      "  proactiveUsedToday(): number {",
      '    return quotaUsed(this.db, "proactive");',
      "  }",
      "",
      "  /** 记一次主动开口 */",
      "  countProactive(): void {",
      '    quotaSpend(this.db, "proactive", this.cfg.proactiveDailyLimit);',
      "  }",
      "",
      "  /**",
      "   * 决定要不要说话、说什么。",
      "   *",
      "   * 关键：它有权沉默。返回「沉默」就是不说——",
      "   * 一个必须开口的机器人，只会变成定时问候机。",
      "   */",
      "  async speakUp(info: { idleMinutes: number; used: number; limit: number }): Promise<string> {",
      "    const hour = String(new Date().getHours()).padStart(2, \"0\");",
      "    const minute = String(new Date().getMinutes()).padStart(2, \"0\");",
      "    return this.act(",
      "      [",
      '        `现在是 ${hour}:${minute}。他 ${info.idleMinutes} 分钟没说话了。`,",
      '        `你今天已经主动找过他 ${info.used} 次（上限 ${info.limit} 次）。`,",
      '        "",',
      '        "你想跟他说点什么吗？",',
      '        "- 没什么真想说的，就只回两个字：沉默",',
      '        "- 想说的，就直接写你要发的那句话（一到两句），不要解释、不要加引号、不要写旁白",',
      '        "",',
      '        "别为了刷存在感而说话。也别问「在吗」这种废话。",',
      '        "可以说你刚看到的东西、想到的事，或者一句真心的关心。",',
      "      ].join(\"\\n\"),",
      "    );",
      "  }",
      "",
      marker,
    ].join("\n");
    s = s.replace(marker, block);
    writeFileSync(p, s, "utf8");
    console.log("service: speakUp 已加");
  }
}
