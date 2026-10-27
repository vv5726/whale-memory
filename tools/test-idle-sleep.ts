/**
 * 验证「说完话几分钟就整理」这条链路真的能通。
 *
 * 做法：直接调 BotService.handle 喂几句话（等同对方发了消息），
 * 等闲置时间过去，再手动触发一次 scheduler 那一拍（maybeSleep），
 * 然后看 pendingTurns 是否归零、记忆里是否多了「他提的要求」。
 */
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { openDb } from "../src/db.ts";
import { pendingTurns } from "../src/sleep.ts";

const DB = process.argv[2] ?? "data/test-idle.db";
const cfgBase = loadBotConfig();
const cfg = { ...cfgBase, memoryDb: DB };

const before = openDb(DB);
const pendingBefore = pendingTurns(before);
const eventsBefore = Number(before.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
before.close();

const svc = new BotService(cfg);
const messages = [
  "以后你每天只能看 20 个 B 站视频，自己挑，别乱刷",
  "发评论之前要先跟我说一声，别自己发",
  "我希望你说话短一点，别老总结我的话",
];

console.log(`闲置整理间隔：${cfg.idleSleepMinutes} 分钟`);
for (const text of messages) {
  const reply = await svc.handle({
    userId: 10001,
    selfId: cfg.selfId,
    userName: "测试",
    text,
    isGroup: false,
    mentioned: false,
    sessionId: "idle-test",
  } as never);
  console.log(`我：${text}`);
  console.log(`它：${reply}\n`);
}

const waitMs = Math.max(2000, cfg.idleSleepMinutes * 60_000 + 1500);
console.log(`等 ${(waitMs / 1000).toFixed(0)} 秒，模拟“说完话没人接”……`);
await new Promise((r) => setTimeout(r, waitMs));

console.log("触发整理（等同 scheduler 那一拍）……");
const stats = await svc.maybeSleep();
svc.close();

const after = openDb(DB);
const pendingAfter = pendingTurns(after);
const eventsAfter = Number(after.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
console.log(`\n待整理：${pendingBefore} → ${pendingAfter}`);
console.log(`事件数：${eventsBefore} → ${eventsAfter}`);
console.log(`本次抽到：${stats?.llm?.inserted ?? 0} 条`);

console.log("\n=== 最新几条记忆 ===");
for (const r of after.prepare("SELECT title, key_facts FROM events ORDER BY ts DESC LIMIT 6").all()) {
  console.log(`- ${r.title}`);
  console.log(`    事实：${r.key_facts}`);
}
after.close();
