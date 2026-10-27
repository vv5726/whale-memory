import { readFileSync, writeFileSync } from "node:fs";

// ── router：转发批准处理 ──
{
  const p = "src/bot/router.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("handleApproval(")) {
    const marker = "  /** 补一句（同一个人，串行队列里排队，别抢在回复前面） */";
    const block = [
      "  /** 处理「准 1234 / 不 1234」：批准了就真的去做 */",
      "  async handleApproval(userId: number, shortId: string, approve: boolean): Promise<string> {",
      "    const service = this.serviceFor(userId);",
      "    const resolved = service.resolveApproval(shortId, approve);",
      '    if (!resolved) return "这个编号我没找到，可能是已经处理过了。";',
      '    if (!approve) return "行，不发了。";',
      "",
      "    const toolName =",
      '      resolved.kind === "comment"',
      '        ? "bili_comment"',
      '        : resolved.kind === "danmaku"',
      '          ? "bili_danmaku"',
      '          : resolved.kind === "dynamic"',
      '            ? "bili_dynamic"',
      '            : resolved.kind === "like"',
      '              ? "bili_like"',
      '              : "";',
      '    if (toolName.length === 0) return "这一笔我不知道怎么执行。";',
      "",
      "    let args: Record<string, unknown> = {};",
      "    try {",
      "      args = JSON.parse(resolved.payload || \"{}\") as Record<string, unknown>;",
      "    } catch {",
      "      args = {};",
      "    }",
      "",
      "    const result = await service.callTool(toolName, { ...args, _approved: true });",
      '    if (!result) return "工具没准备好，这次没办成。";',
      '    return result.ok ? `办好了：${result.text}` : `没办成：${result.text}`;',
      "  }",
      "",
      marker,
    ].join("\n");
    s = s.replace(marker, block);
    writeFileSync(p, s, "utf8");
    console.log("router：handleApproval 已加");
  }
}

// ── bot.ts：notify 接线 + 拦截批准回复 ──
{
  const p = "src/bot.ts";
  let s = readFileSync(p, "utf8");

  if (!s.includes("approvalRequired")) {
    s = s.replace(
      "  const router = new BotRouter(cfg);",
      "  // 对外发东西前先问他：通知走私聊，批准后由 router 执行\n  const router = new BotRouter(cfg, {\n    notify: (text) => {\n      if (client) client.sendPrivate(ownerId, text);\n    },\n  });",
    );
  }

  if (!s.includes("parseApprovalReply")) {
    s = s.replace(
      'import { AutonomyLoop } from "./bot/autonomy.ts";',
      'import { AutonomyLoop } from "./bot/autonomy.ts";\nimport { parseApprovalReply } from "./approvals.ts";',
    );
    s = s.replace(
      "      loop.noteUserMessage();\n      const reply = await router.handle(evt);",
      [
        "      loop.noteUserMessage();",
        "",
        "      // 先看是不是在答复某笔待批",
        "      const approval = parseApprovalReply(evt.text);",
        "      if (approval) {",
        "        const answer = await router.handleApproval(evt.userId, approval.shortId, approval.approve);",
        "        if (client) await client.sendBubbles(evt, answer);",
        "        return;",
        "      }",
        "",
        "      const reply = await router.handle(evt);",
      ].join("\n"),
    );
  }

  writeFileSync(p, s, "utf8");
  console.log("bot.ts：批准回复拦截已接");
}
