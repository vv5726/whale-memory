/** 验证场景注入：同一条消息，私聊和群聊看到的东西不一样 */
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });

const base = {
  userId: 10001,
  selfId: cfg.selfId,
  userName: "他",
  text: "这个 bug 怎么修",
  mentioned: false,
  sessionId: "scenetest",
};

// 私聊
const priv = await svc.handle({ ...base, isGroup: false });
console.log(`私聊回复：${String(priv).slice(0, 60)}`);

// 群聊（白名单里的群）
const grp = await svc.handle({ ...base, isGroup: true, groupId: 20001, mentioned: true, sessionId: "scenetest2" });
console.log(`群聊回复：${String(grp).slice(0, 60)}`);

svc.close();
