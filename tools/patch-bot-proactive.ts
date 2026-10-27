import { readFileSync, writeFileSync } from "node:fs";

const p = "src/bot.ts";
let s = readFileSync(p, "utf8");

// 1) 给 loop 传 onSpeak
s = s.replace(
  "  const loop = new AutonomyLoop(cfg, autonomyService);",
  [
    "  const loop = new AutonomyLoop(cfg, autonomyService, (text) => {",
    "    if (client) {",
    "      client.sendPrivate(ownerId, text);",
    "      console.log(`[speak] 主动发给他：${text}`);",
    "    }",
    "  });",
  ].join("\n"),
);

// 2) 启动主动开口定时器
s = s.replace(
  "  const stopAutonomy = loop.start();",
  "  const stopAutonomy = loop.start();\n  const stopSpeaking = cfg.proactiveEnabled ? loop.startSpeaking(10) : () => undefined;\n  console.log(`[speak] 他 ${cfg.proactiveIdleMinutes} 分钟没说话后，我可能会主动找他（每天最多 ${cfg.proactiveDailyLimit} 次）`);",
);

// 3) 关停时清掉
s = s.replace("    stopAutonomy();", "    stopAutonomy();\n    stopSpeaking();");

writeFileSync(p, s, "utf8");
console.log(s.includes("startSpeaking") ? "bot.ts 已接线" : "失败");
