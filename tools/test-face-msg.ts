import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });

const r = await svc.handle({
  userId: 10001,
  selfId: cfg.selfId,
  userName: "他",
  text: '[CQ:face,id=467,raw={"faceText":"/摇花手"}]',
  isGroup: false,
  mentioned: false,
  sessionId: "cq-test",
});
console.log(`回答：${String(r).replace(/\n/g, " / ").slice(0, 140)}`);
svc.close();
