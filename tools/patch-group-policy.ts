import { readFileSync, writeFileSync } from "node:fs";

// ① 群消息门控：先看她对这个群的设置，再落回全局
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");

  s = s.replace(
    'if (evt.isGroup && this.cfg.groupReplyMode === "mention" && evt.mentioned !== true) {',
    `// 每个群可以有自己的模式（她自己设的），没设就按全局
    const groupMode =
      evt.isGroup && evt.groupId !== undefined
        ? modeFor(this.cfg.dataDir, evt.groupId, this.cfg.groupReplyMode)
        : this.cfg.groupReplyMode;
    if (evt.isGroup && groupMode === "mention" && evt.mentioned !== true) {`,
  );

  if (!s.includes("group-policy.ts")) {
    s = s.replace(
      'import { loadSpeechRules } from "../speech-rules.ts";',
      'import { loadSpeechRules } from "../speech-rules.ts";\nimport { modeFor } from "../group-policy.ts";',
    );
  }

  writeFileSync(p, s, "utf8");
  console.log("① 群门控已接");
}

// ② 注册工具
{
  const p = "src/tools/index.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("registerGroupPolicyTools")) {
    s = s.replace(
      'import { registerVerifyTools } from "./verify.ts";',
      'import { registerVerifyTools } from "./verify.ts";\nimport { registerGroupPolicyTools } from "./group-policy.ts";',
    );
    s = s.replace(
      "  registerVerifyTools(registry, { dataDir: cfg.dataDir });",
      "  registerVerifyTools(registry, { dataDir: cfg.dataDir });\n  registerGroupPolicyTools(registry, {\n    dataDir: cfg.dataDir,\n    defaultMode: cfg.groupReplyMode,\n    allowGroups: cfg.allowGroups ?? [],\n  });",
    );
    writeFileSync(p, s, "utf8");
    console.log("② 工具已注册");
  }
}
