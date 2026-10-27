import { readFileSync, writeFileSync } from "node:fs";

// 1) BotService.followUp
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("async followUp(")) {
    const marker = "  /** 把一条笔记直接写进记忆";
    const block = [
      "  /**",
      "   * 刚回完一句，还想补一句吗。",
      "   *",
      "   * 人在聊天里不是一问一答：说完会自己再补半句、想起个事、",
      "   * 或者笑一下。这个动作就是补那半句。",
      "   */",
      "  async followUp(): Promise<string> {",
      "    const out = await this.act(",
      "      [",
      '        "你刚回完他一句。",',
      '        "还有半句想补的吗？想就只写那一句（很短，一句或几个字），不想就只回：沉默",',
      '        "可以补充、反悔、想起一件事、或者笑一下。别重复刚才说过的话。",',
      "      ].join(\"\\n\"),",
      "    );",
      '    return out.trim().startsWith("沉默") ? "" : out.trim();',
      "  }",
      "",
      marker,
    ].join("\n");
    s = s.replace(marker, block);
    writeFileSync(p, s, "utf8");
    console.log("service.followUp 已加");
  }
}

// 2) BotRouter.followUp
{
  const p = "src/bot/router.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("followUp(")) {
    const marker = "  /** 每个用户的记忆各自按闲置/定点睡觉 */";
    const block = [
      "  /** 补一句（同一个人，串行队列里排队，别抢在回复前面） */",
      "  async followUp(userId: number): Promise<string> {",
      "    const service = this.serviceFor(userId);",
      "    const task = this.chain.then(() => service.followUp());",
      "    this.chain = task.then(",
      "      () => undefined,",
      "      () => undefined,",
      "    );",
      "    return task;",
      "  }",
      "",
      marker,
    ].join("\n");
    s = s.replace(marker, block);
    writeFileSync(p, s, "utf8");
    console.log("router.followUp 已加");
  }
}

// 3) bot.ts：回完有概率补一句
{
  const p = "src/bot.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("followUp(evt.userId)")) {
    s = s.replace(
      "      if (reply) void client.sendBubbles(evt, reply);",
      [
        "      if (reply) {",
        "        await client.sendBubbles(evt, reply);",
        "        // 一段聊天里偶尔自己接一句，不等他问",
        "        if (Math.random() < 0.25) {",
        "          const extra = await router.followUp(evt.userId).catch(() => \"\");",
        "          if (extra) await client.sendBubbles(evt, extra);",
        "        }",
        "      }",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("bot.ts 补话已接");
  }
}
