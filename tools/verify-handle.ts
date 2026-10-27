// 一次性验证：真跑一次 handle()，再跑一次 speakUp()，把运行时真正用到的东西打出来。
// 用 data/tmp-verify.db（memory.db 的副本），不污染真库。
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { loadTuning } from "../src/tuning.ts";

const src = "data/memory.db";
const tmp = "data/tmp-verify.db";
for (const p of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(p)) rmSync(p);
copyFileSync(src, tmp);

const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: tmp });

const tune = loadTuning(cfg.dataDir);
console.log("tuning:", JSON.stringify(tune));
console.log("tuning 里有 followUp 吗:", "followUpChance" in tune ? "有（不该有）" : "没有 ✓");
console.log("BotService 有 followUp 方法吗:", "followUp" in svc ? "有（不该有）" : "没有 ✓");

const reply = await svc.handle({
  userId: 10001,
  selfId: cfg.selfId,
  userName: "他",
  text: "在吗",
  isGroup: false,
  mentioned: false,
  sessionId: "10001",
});
console.log("\nhandle() 回的是：", String(reply).slice(0, 200));

try {
  const spoken = await svc.speakUp({ idleMinutes: 40, used: 1, limit: 3 });
  console.log("speakUp() 回的是：", String(spoken).slice(0, 200));
} catch (err) {
  console.log("speakUp() 报错：", err instanceof Error ? err.message : String(err));
}

svc.close();
for (const p of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(p)) rmSync(p);
