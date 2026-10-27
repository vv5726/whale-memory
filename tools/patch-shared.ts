import { readFileSync, writeFileSync } from "node:fs";

// config：加 sharedMemory
{
  const p = "src/bot/config.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("sharedMemory")) {
    s = s.replace(
      "  /** 记忆库根目录（每个人的库会落在 <dataDir>/users/<QQ号>.db） */",
      ["  /** 所有人共用一个记忆库（data/memory.db），而不是每人一个 */", "  sharedMemory: boolean;", "  /** 记忆库根目录（分人模式下落在 <dataDir>/users/<QQ号>.db） */"].join(
        "\n",
      ),
    );
    s = s.replace('  dataDir: join(ROOT, "data"),', '  dataDir: join(ROOT, "data"),\n  sharedMemory: true,');
    writeFileSync(p, s, "utf8");
    console.log("config：sharedMemory 已加，默认 true");
  }
}

// bot.json：共享记忆 + 群里每条都回
{
  const p = "data/bot.json";
  const j = JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  j.sharedMemory = true;
  j.groupReplyMode = "all";
  j.recordGroupChat = true;
  writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`, "utf8");
  console.log("bot.json：sharedMemory=true，groupReplyMode=all，recordGroupChat=true");
}
