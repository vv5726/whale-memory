import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract.ts";
let s = readFileSync(p, "utf8");

// ① import
if (!s.includes("loadExtractRules")) {
  s = s.replace(
    'import { loadAnchorIndex',
    'import { loadExtractRules, rulesVersion } from "../extract-rules.ts";\nimport { loadAnchorIndex',
  );
}

// ② 系统提示词末尾追加她写的规则
if (!s.includes("她自己加的规则")) {
  s = s.replace(
    '  ].join("\\n");\n\n  const user = [',
    [
      '  ].join("\\n");',
      "",
      "  // 她自己加的规则：原文追加，不动代码里的底线",
      '  const herRules = loadExtractRules(cfg.dataDir ?? "data");',
      "  const systemText = herRules",
      '    ? `${system}\\n\\n规则（这些是凝自己加的，优先于上面同类的说法）：\\n${herRules}`',
      "    : system;",
      "",
      "  const user = [",
    ].join("\n"),
  );
}

writeFileSync(p, s, "utf8");
console.log("规则追加点已处理");
