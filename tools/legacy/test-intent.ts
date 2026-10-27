/** 验证「目的+途径」：逼它走一次，看它选哪条路 */
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { parseIntent } from "../src/intent.ts";
import { recentAnchors, rememberThought } from "../src/thought.ts";

const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/users/10001.db" });

const exclude = recentAnchors(cfg.dataDir);
const anchor = svc.randomAnchor(exclude);
if (!anchor) {
  console.log("没有可用锚点");
  process.exit(0);
}
console.log(`想起：${anchor.name}（${anchor.kind}）  最近想过的：${exclude.join("、") || "无"}`);
console.log(`相关记忆 ${anchor.memories.length} 条\n`);

const raw = await svc.think({ ...anchor, repeats: 0 });
const intent = parseIntent(raw);

console.log("=== 它的原话 ===");
console.log(raw.trim().slice(0, 800));
console.log("\n=== 解析结果 ===");
console.log(`目的：${intent.goal || "（没写）"}`);
console.log(`途径：${intent.channel}`);
if (intent.message) console.log(`消息：${intent.message}`);
if (intent.action) console.log(`动作：${intent.action}`);

rememberThought(cfg.dataDir, {
  anchor: anchor.name,
  at: Date.now(),
  goal: intent.goal,
  channel: intent.channel,
});
svc.close();
