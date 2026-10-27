import { readFileSync, writeFileSync } from "node:fs";

// 1) autonomy：每次没动也说一声（否则看起来像死了）
{
  const p = "src/bot/autonomy.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("这次没动")) {
    const anchor = "    this.timer = setInterval(() => {\n      void this.runOnce().then((r) => {\n        if (r.ran) console.log(`[autonomy] ${r.reason}`);\n      });\n    }, intervalMs);";
    const replacement = [
      "    this.timer = setInterval(() => {",
      "      void this.runOnce().then((r) => {",
      "        // 没动也要说一声：不然从外面看，它就像死了",
      '        console.log(r.ran ? `[autonomy] 动了：${r.reason}` : `[autonomy] 这次没动：${r.reason}`);',
      "      });",
      "    }, intervalMs);",
    ].join("\n");
    if (s.includes(anchor)) {
      s = s.replace(anchor, replacement);
      writeFileSync(p, s, "utf8");
      console.log("autonomy: 静默原因会打日志");
    } else {
      console.log("autonomy 锚点没匹配");
    }
  }
}

// 2) 掷骰子基数抬高一点
{
  const p = "src/bot/autonomy.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace("    let p = 0.45;", "    let p = 0.62;");
  writeFileSync(p, s, "utf8");
  console.log("骰子基数 0.45 → 0.62");
}

// 3) 节奏收紧：间隔 20→8 分钟，刚聊过 8→3 分钟，玩手机概率 0.35→0.5
{
  const p = "data/bot.json";
  const j = JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  j.autonomyMinutes = 8;
  j.autonomyIdleMinutes = 3;
  j.phonePlayChance = 0.5;
  writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`, "utf8");
  console.log(`bot.json: 间隔 ${j.autonomyMinutes} 分钟，聊完 ${j.autonomyIdleMinutes} 分钟就能动，玩手机 ${j.phonePlayChance}`);
}
