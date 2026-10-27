import { readFileSync, writeFileSync } from "node:fs";

// ── 1) 工具装配：把 approvalRequired / notify 传下去 ──
{
  const p = "src/tools/index.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace(
    "export function buildTools(cfg: BotConfig, db?: DatabaseSync): ToolRegistry {",
    "export function buildTools(\n  cfg: BotConfig,\n  db?: DatabaseSync,\n  notify?: (text: string) => void,\n): ToolRegistry {",
  );
  s = s.replace(
    "    videoQuota: cfg.biliDailyVideoQuota,\n    db,",
    "    videoQuota: cfg.biliDailyVideoQuota,\n    db,\n    approvalRequired: cfg.approvalRequired,\n    notify,",
  );
  writeFileSync(p, s, "utf8");
  console.log("buildTools：已接 notify");
}

// ── 2) config：加 approvalRequired ──
{
  const p = "src/bot/config.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("approvalRequired")) {
    s = s.replace(
      "  /** 每天能看几个视频（读字幕算一次）；额度用完就等明天 */\n  biliDailyVideoQuota: number;",
      [
        "  /** 每天能看几个视频（读字幕算一次）；额度用完就等明天 */",
        "  biliDailyVideoQuota: number;",
        "  /** 评论/弹幕/动态发出去之前，要不要先问本人 */",
        "  approvalRequired: boolean;",
      ].join("\n"),
    );
    s = s.replace("  biliDailyVideoQuota: 0,", "  biliDailyVideoQuota: 0,\n  approvalRequired: true,");
    writeFileSync(p, s, "utf8");
    console.log("config：approvalRequired 已加");
  }
}

// ── 3) service：暴露 resolveApproval 和 callTool ──
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("resolveApproval(")) {
    s = s.replace(
      'import { recordOwnNote } from "../notes.ts";',
      'import { recordOwnNote } from "../notes.ts";\nimport { resolveApproval, type Approval } from "../approvals.ts";',
    );
    const marker = "  /** 今天已经主动说了几次 */";
    const block = [
      "  /** 处理「准 1234 / 不 1234」 */",
      "  resolveApproval(shortId: string, approve: boolean): Approval | null {",
      "    return resolveApproval(this.db, shortId, approve);",
      "  }",
      "",
      "  /** 直接调一个工具（批准之后执行用） */",
      "  async callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string } | null> {",
      "    if (!this.tools) return null;",
      "    return this.tools.call(name, args);",
      "  }",
      "",
      marker,
    ].join("\n");
    s = s.replace(marker, block);
    writeFileSync(p, s, "utf8");
    console.log("service：resolveApproval + callTool 已加");
  }
}
