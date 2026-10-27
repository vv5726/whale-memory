/** 打印真实的一轮上下文，看结构对不对 */
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });

// 用现有的历史造一轮，但把真正发请求截下来
const svcAny = svc as unknown as { historyFor: (s: string) => Array<{ role: string; text: string }> };
const history = svcAny.historyFor("dump");
console.log(`历史条数：${history.length}`);
console.log("最近 6 条：");
for (const h of history.slice(-6)) {
  console.log(`  ${h.role === "user" ? "他" : "我"}：${String(h.text).slice(0, 60).replace(/\n/g, " ")}`);
}
svc.close();
