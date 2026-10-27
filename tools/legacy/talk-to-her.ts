/** 跟凝聊两句：告诉它假的锚点已经删了，看它怎么想 */
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });

const turns = [
  "我查过了：记忆里一条都没有。妈妈0条、手术0条、还钱0条、王建国0条、甲状腺0条。脏的只有锚点，数据是干净的。",
  "那你现在看自己这套记忆，最想改的是什么？只挑最想改的一件事说。",
];

for (const text of turns) {
  const reply = await svc.handle({
    userId: 10001,
    selfId: cfg.selfId,
    userName: "他",
    text,
    isGroup: false,
    mentioned: false,
    sessionId: "10001",
  });
  console.log(`\n我：${text}`);
  console.log(`凝：${String(reply).trim()}`);
}
svc.close();
