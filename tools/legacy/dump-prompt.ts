/** 把真实拼出来的 system 打出来：群号、QQ号、当前说话人到底在不在 */
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });

const svcAny = svc as unknown as {
  historyFor: (s: string) => Array<{ role: string; text: string; speaker?: string }>;
};

// 截获真正发给模型的 messages
const proto = Object.getPrototypeOf(svc) as { buildPrompt?: unknown };

const { buildChatPrompt } = await import("../src/bot/persona.ts");

const msgs = buildChatPrompt({
  memory: { contextBlock: "（记忆）" },
  userName: "小红",
  message: "群号是多少",
  history: [],
  memoryWeak: false,
  selfText: "",
  today: { watched: [], notes: [] },
  quota: { videoLimit: 0, videoUsed: 0, writeLimit: 0, writeUsed: 0 },
  toolNames: [],
  stats: { events: 0, anchors: 0, edges: 0, pending: 0 },
  alwaysOn: [],
  people: [{ qqId: "999002", name: "小红", aliases: [] }],
  peopleQq: "999002",
  terms: [],
  scene: "QQ 群（群号 20003）。这是群聊，不是私聊。",
  currentSpeaker: "小红",
  currentSpeakerQq: "999002",
});

const sys = String(msgs[0]?.content ?? "");
console.log("=== system 里有没有群号 ===");
console.log(sys.includes("群号 20003") ? "✓ 有" : "✗ 没有");
const i = sys.indexOf("【这里是哪儿】");
console.log(i >= 0 ? sys.slice(i, i + 120) : "（没有这一段）");

console.log("");
console.log("=== 当前这条消息长什么样 ===");
const last = msgs[msgs.length - 1];
console.log(JSON.stringify(last));

svc.close();
