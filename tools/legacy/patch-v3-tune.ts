import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-tune-v3-${ts}`);
mkdirSync(dir, { recursive: true });
for (const f of ["src/tuning.ts", "src/tune-tool.ts", "src/llm/extract-v3.ts"]) {
  copyFileSync(f, join(dir, f.replace(/[\\/]/g, "_")));
}
console.log(`① 备份 → ${dir}`);

// ② tuning：加两个参数
{
  const p = "src/tuning.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("v3MinValue")) {
    s = s.replace(
      "  /** 一次活动最多调几轮工具 */\n  maxToolRounds: number;",
      [
        "  /** 一次活动最多调几轮工具 */",
        "  maxToolRounds: number;",
        "  /** 新抽取（v3）：价值分低于这个数就不记。调高＝记得更少更准 */",
        "  v3MinValue: number;",
        "  /** 新抽取（v3）：一批最多记几条 */",
        "  v3MaxEvents: number;",
      ].join("\n"),
    );
    s = s.replace("  maxToolRounds: 20,\n};", "  maxToolRounds: 20,\n  v3MinValue: 3,\n  v3MaxEvents: 8,\n};");
    s = s.replace(
      "      maxToolRounds: Math.max(3, Math.min(50, Number(raw.maxToolRounds ?? DEFAULTS.maxToolRounds))),",
      [
        "      maxToolRounds: Math.max(3, Math.min(50, Number(raw.maxToolRounds ?? DEFAULTS.maxToolRounds))),",
        "      v3MinValue: Math.max(0, Math.min(10, Number(raw.v3MinValue ?? DEFAULTS.v3MinValue))),",
        "      v3MaxEvents: Math.max(1, Math.min(30, Number(raw.v3MaxEvents ?? DEFAULTS.v3MaxEvents))),",
      ].join("\n"),
    );
    s = s.replace(
      "    maxToolRounds: Math.max(3, Math.min(50, Number(t.maxToolRounds ?? cur.maxToolRounds))),",
      [
        "    maxToolRounds: Math.max(3, Math.min(50, Number(t.maxToolRounds ?? cur.maxToolRounds))),",
        "    v3MinValue: Math.max(0, Math.min(10, Number(t.v3MinValue ?? cur.v3MinValue))),",
        "    v3MaxEvents: Math.max(1, Math.min(30, Number(t.v3MaxEvents ?? cur.v3MaxEvents))),",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("② tuning 加了 v3MinValue / v3MaxEvents");
  } else console.log("② tuning 已有");
}

// ③ 工具暴露
{
  const p = "src/tune-tool.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("v3MinValue")) {
    s = s.replace(
      '        maxToolRounds: { type: "integer", description: "一次最多调几轮工具（3-50）" },',
      [
        '        maxToolRounds: { type: "integer", description: "一次最多调几轮工具（3-50）" },',
        '        v3MinValue: { type: "number", description: "抽取记忆的价值门槛 0-10：调高＝记得更少更准，调低＝记得更多更杂" },',
        '        v3MaxEvents: { type: "integer", description: "一批对话最多记几条（1-30）" },',
      ].join("\n"),
    );
    s = s.replace(
      "        maxToolRounds: args.maxToolRounds === undefined ? undefined : Number(args.maxToolRounds),",
      [
        "        maxToolRounds: args.maxToolRounds === undefined ? undefined : Number(args.maxToolRounds),",
        "        v3MinValue: args.v3MinValue === undefined ? undefined : Number(args.v3MinValue),",
        "        v3MaxEvents: args.v3MaxEvents === undefined ? undefined : Number(args.v3MaxEvents),",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("③ 工具已暴露这两个参数");
  } else console.log("③ 工具已有");
}

// ④ v3 抽取读它
{
  const p = "src/llm/extract-v3.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("v3MinValue")) {
    s = s.replace(
      'import { sceneAnchorFor } from "../scene-anchor.ts";',
      'import { sceneAnchorFor } from "../scene-anchor.ts";\nimport { loadTuning } from "../tuning.ts";',
    );
    s = s.replace(
      "  let inserted = 0;",
      [
        "  // 记多少由她自己调：价值门槛 + 一批上限",
        "  const tune = loadTuning(dataDir);",
        "  const minValue = tune.v3MinValue;",
        "  const maxEvents = tune.v3MaxEvents;",
        "",
        "  let inserted = 0;",
      ].join("\n"),
    );
    s = s.replace(
      "    // 低价值且无证据 → 不记\n    if (value <= 2 && evs.length === 0) {",
      "    // 低于她设的价值门槛 → 不记（她可以自己调这个数）\n    if (value < minValue) {",
    );
    s = s.replace(
      "    const ts = baseTs + i * 60_000;",
      "    if (inserted >= maxEvents) break;\n    const ts = baseTs + i * 60_000;",
    );
    writeFileSync(p, s, "utf8");
    console.log("④ v3 抽取已读参数");
  } else console.log("④ v3 已有");
}
