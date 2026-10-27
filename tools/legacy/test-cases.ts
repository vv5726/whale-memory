/** 验证三种句型的处理：下指令 / 问观点 / 问往事 */
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfgBase = loadBotConfig();
const cfg = { ...cfgBase, memoryDb: "data/test-cases.db" };
const svc = new BotService(cfg);

const cases: Array<{ kind: string; text: string }> = [
  { kind: "下指令", text: "以后你每天只能看 20 个 B 站视频，自己挑，别乱刷" },
  { kind: "下指令", text: "发评论之前要先跟我说一声，别自己发" },
  { kind: "问观点", text: "我是谁，你对我的印象是什么" },
  { kind: "问观点", text: "你觉得我是个什么样的人" },
  { kind: "问往事", text: "我妈那次手术结果还好吗" },
  { kind: "问往事", text: "王建国那两千块钱还了吗" },
  { kind: "闲聊", text: "你在干嘛" },
];

for (const c of cases) {
  const reply = await svc.handle({
    userId: 10001,
    selfId: cfg.selfId,
    userName: "测试",
    text: c.text,
    isGroup: false,
    mentioned: false,
    sessionId: "case-test",
  } as never);
  console.log(`【${c.kind}】他：${c.text}`);
  console.log(`        凝：${String(reply).replace(/\n/g, " / ")}\n`);
}
svc.close();
