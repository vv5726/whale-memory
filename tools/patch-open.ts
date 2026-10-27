import { readFileSync, writeFileSync } from "node:fs";

// ── 1) 写操作：0 = 不限次数 ──
{
  const p = "src/tools/bili.ts";
  let s = readFileSync(p, "utf8");

  const oldGuard = [
    "  const writeGuard = (limit: number): { ok: true; jct: string } | { ok: false; text: string } => {",
    '    if (!hasJct) return { ok: false, text: "没有配置 bili_jct，做不了写操作（点赞/评论/弹幕/动态都需要它）" };',
    "    const budget = writeBudget(limit);",
    "    if (!budget.ok) {",
    "      return { ok: false, text: `今天已经做了 ${budget.used} 次写操作，到上限了，明天再说` };",
    "    }",
    "    return { ok: true, jct: opts.jct ?? \"\" };",
    "  };",
  ].join("\n");

  const newGuard = [
    "  const writeGuard = (limit: number): { ok: true; jct: string } | { ok: false; text: string } => {",
    '    if (!hasJct) return { ok: false, text: "没有配置 bili_jct，做不了写操作（点赞/评论/弹幕/动态都需要它）" };',
    "    // limit <= 0 表示不限次数",
    "    if (limit > 0) {",
    "      const budget = writeBudget(limit);",
    "      if (!budget.ok) {",
    "        return { ok: false, text: `今天已经做了 ${budget.used} 次写操作，到上限了，明天再说` };",
    "      }",
    "    }",
    '    return { ok: true, jct: opts.jct ?? "" };',
    "  };",
  ].join("\n");

  if (s.includes(oldGuard)) {
    s = s.replace(oldGuard, newGuard);
    console.log("写操作：0 = 不限");
  }

  // 工具描述里删掉「只有对方明确要求才做」
  s = s.replace(
    "⚠️ 只有对方**明确要求**点赞时才用，不要自己看到顺眼的就点——那是在拿对方的账号刷数据。",
    "想点赞就点。看到值得的就点一个。",
  );
  s = s.replace(
    "⚠️ 只有对方**明确要求**时才发，内容要用对方的意思，别自己发挥。发出去别人都能看见。",
    "想说什么就说。这是你自己的评论区。",
  );
  s = s.replace("⚠️ 只有对方**明确要求**时才发。弹幕会飘在视频画面上，所有人都看得到。", "想说就在那一秒发一条。");
  s = s.replace(
    "⚠️ 这是**公开发布**，只有对方明确要求时才发，内容必须用对方给的。",
    "想发就发。这是你自己的动态。",
  );

  writeFileSync(p, s, "utf8");
}

// ── 2) 配置默认值：写操作不限，视频不限 ──
{
  const p = "src/bot/config.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace("  biliDailyWriteLimit: 20,", "  biliDailyWriteLimit: 0,");
  s = s.replace("  biliDailyVideoQuota: 20,", "  biliDailyVideoQuota: 0,");
  writeFileSync(p, s, "utf8");
}

// ── 3) bot.json 同步 ──
{
  const p = "data/bot.json";
  const j = JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  j.biliDailyWriteLimit = 0;
  j.biliDailyVideoQuota = 0;
  writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`, "utf8");
  console.log(`bot.json: 写操作 ${j.biliDailyWriteLimit}（0=不限），视频 ${j.biliDailyVideoQuota}（0=不限）`);
}
