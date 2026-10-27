import { readFileSync, writeFileSync } from "node:fs";

// ── 1) autonomy：删掉轮次闸 ──
{
  const p = "src/bot/autonomy.ts";
  let s = readFileSync(p, "utf8");
  const line = '    if (budget.roundsLeft <= 0) return { ok: false, reason: "今天的活动次数用完了" };\n';
  if (s.includes(line)) {
    s = s.replace(line, "");
    writeFileSync(p, s, "utf8");
    console.log("autonomy：轮次闸已删");
  } else {
    console.log("autonomy：没找到轮次闸");
  }
}

// ── 2) service：删掉 act 里的轮次检查与扣减 ──
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  const a = '    if (budget.roundsLeft <= 0) return "今天的自主活动次数用完了。";\n';
  const b = '    quotaSpend(this.db, "autonomy", this.cfg.autonomyDailyRounds);\n';
  let changed = 0;
  if (s.includes(a)) {
    s = s.replace(a, "");
    changed += 1;
  }
  if (s.includes(b)) {
    s = s.replace(b, "");
    changed += 1;
  }
  writeFileSync(p, s, "utf8");
  console.log(`service：删了 ${changed} 处轮次逻辑`);
}

// ── 3) bot.json ──
{
  const p = "data/bot.json";
  const j = JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  j.autonomyDailyRounds = 0;
  writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`, "utf8");
  console.log("bot.json：autonomyDailyRounds = 0（不限）");
}
