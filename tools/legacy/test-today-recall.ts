/** 验证：问「刷过什么」能不能答上来 */
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/users/10001.db" });

console.log("今天有多少数据：", JSON.stringify(svc.todaySnapshot(), null, 1));

for (const q of ["你还能记住你刷过的东西吗", "你今天看了啥", "你记得折叠屏那个吗"]) {
  const out = await svc.say(q, "本人");
  console.log(`\n他：${q}`);
  console.log(`凝：${out.reply.replace(/\n/g, " / ")}`);
}
svc.close();
