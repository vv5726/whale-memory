import { readFileSync, writeFileSync } from "node:fs";

// ── bili 写操作：改成「先请示」 ──
{
  const p = "src/tools/bili.ts";
  let s = readFileSync(p, "utf8");

  if (!s.includes("createApproval")) {
    s = s.replace(
      'import { quotaRemaining, quotaSpend } from "../quota.ts";',
      'import { quotaRemaining, quotaSpend } from "../quota.ts";\nimport { createApproval } from "../approvals.ts";',
    );
  }

  // 选项里加 notify + approvalRequired
  s = s.replace(
    "  /** 额度记在库里，重启不丢 */\n  db?: DatabaseSync;",
    [
      "  /** 额度记在库里，重启不丢 */",
      "  db?: DatabaseSync;",
      "  /** 对外发东西之前要不要先问本人 */",
      "  approvalRequired?: boolean;",
      "  /** 把「想做什么」发给他，等他点头 */",
      "  notify?: (text: string) => void;",
    ].join("\n"),
  );

  writeFileSync(p, s, "utf8");
  console.log("bili：选项已扩展");
}
