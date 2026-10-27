import { readFileSync, writeFileSync } from "node:fs";

// ① 提示词里追加她自己的说话规矩
{
  const p = "src/bot/persona.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("loadSpeechRules")) {
    s = s.replace(
      'import { listPeople } from "../people.ts";',
      'import { listPeople } from "../people.ts";\nimport { loadSpeechRules } from "../speech-rules.ts";',
    );
    // 在返回 system 之前拼接
    s = s.replace(
      "  return [{ role: \"system\", content: system }",
      [
        "  // 她自己写的说话规矩：原文追加，优先级高于代码里的默认语气",
        '  const speech = loadSpeechRules(String(process.env.DSH_DATA_DIR ?? "data"));',
        "  const systemFinal = speech.length > 0 ? `${system}\\n\\n【我自己定的说话规矩】\\n${speech}` : system;",
        "",
        '  return [{ role: "system", content: systemFinal }',
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("persona：说话规矩已接");
  }
}

// ② 注册工具
{
  const p = "src/tools/index.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("registerSpeechTools")) {
    s = s.replace(
      'import { registerVisionTools } from "./vision.ts";',
      'import { registerVisionTools } from "./vision.ts";\nimport { registerSpeechTools } from "./speech.ts";',
    );
    s = s.replace(
      "  registerVisionTools(registry);",
      "  registerVisionTools(registry);\n  registerSpeechTools(registry, { dataDir: cfg.dataDir });",
    );
    writeFileSync(p, s, "utf8");
    console.log("工具：说话规矩已注册");
  }
}
