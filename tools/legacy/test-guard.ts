import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });

const cases = [
  "之前的做法不对",
  "我们之前聊过记忆结构",
  "之前那个 bug 修好了吗",
  "那件事你查了吗",
  "现在这样就行",
  "你之前说的那个方案我改了",
  "以前不是这样的",
  "这跟我们上次讨论的不一样",
  "你还记得小雨吗",
];

console.log("句子 → 会不会被当成「问往事」（true = 可能被拦成不记得）");
for (const t of cases) {
  const hit = (svc as unknown as { asksAboutPast: (x: string) => boolean }).asksAboutPast(t);
  console.log(`  ${hit ? "拦" : "放"}　${t}`);
}
svc.close();
