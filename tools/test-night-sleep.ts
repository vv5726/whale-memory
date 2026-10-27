/** 验证：凌晨窗口能触发整理，而且真的把待整理的对话抽成记忆 */
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { openDb } from "../src/db.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");
const before = {
  events: Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0),
  edges: Number(db.prepare("SELECT COUNT(*) AS c FROM edges").get()?.c ?? 0),
  pending: Number(db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get()?.c ?? 0),
};
console.log(`前：事件 ${before.events}，锚点关系 ${before.edges}，待整理 ${before.pending}`);
if (before.pending === 0) {
  console.log("没有待整理，跳过");
  process.exit(0);
}

const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });

// 假装现在是凌晨 3:30
const three = new Date();
three.setHours(3, 30, 0, 0);
const stats = await svc.maybeSleep(three.getTime());
console.log(`睡眠结果：${stats ? "已整理" : "没触发"}`);

const after = {
  events: Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0),
  edges: Number(db.prepare("SELECT COUNT(*) AS c FROM edges").get()?.c ?? 0),
  pending: Number(db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get()?.c ?? 0),
};
console.log(`后：事件 ${after.events}，锚点关系 ${after.edges}，待整理 ${after.pending}`);
console.log(`变化：事件 +${after.events - before.events}，关系 +${after.edges - before.edges}`);
svc.close();
