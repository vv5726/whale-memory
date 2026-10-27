// 验收 C：各种"途径"写法都要解析对；顺手验证 D 的提示词行
import { parseIntent } from "../src/intent.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { existsSync, copyFileSync, rmSync } from "node:fs";

const cases: Array<[string, string]> = [
  ["途径：聊天\n消息：在吗\n给：他", "chat"],
  ["途径：找人聊天\n消息：在吗\n给：他", "chat"],
  ["途径：聊天（私聊）\n消息：在吗", "chat"],
  ["途径：找他聊天\n消息：在吗", "chat"],
  ["途径：私聊\n消息：喂", "chat"],
  ["途径：内容\n消息：", "content"],
  ["途径：刷B站", "content"],
  ["途径：做\n消息：", "act"],
  ["途径：自己做点什么\n消息：", "act"],
  ["途径：整理记忆", "act"],
  ["途径：算了\n消息：", "none"],
  ["途径：不做", "none"],
  ["途径：没什么要做的", "none"],
  ["消息：我想跟你说个事\n给：他", "chat"], // 没写途径
  ["目的：问问他在干嘛\n途径：找人聊天\n消息：在干嘛呢\n给：他", "chat"],
  ["途径：聊天\n消息：我给你：带了个东西\n给：他", "chat"], // 正文里有「给：」不该截断
  ["途径：聊天\n消息：", "chat"], // 解析成 chat，但没内容 → 由 thinkOnce 拦
  ["", "none"],
];

let bad = 0;
for (const [raw, want] of cases) {
  const got = parseIntent(raw).channel;
  const ok = got === want;
  if (!ok) bad += 1;
  console.log(`${ok ? "✓" : "✗"} ${JSON.stringify(raw).slice(0, 42).padEnd(44)} → ${got}${ok ? "" : `（期望 ${want}）`}`);
}
console.log(`\n${bad === 0 ? "全部通过" : `${bad} 个不对`}`);

// D：想到「人」时，提示词里应该有一句引导
const tmp = "data/tmp-intent.db";
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(f)) rmSync(f);
copyFileSync("data/memory.db", tmp);
const svc = new BotService({ ...loadBotConfig(), memoryDb: tmp } as never, { deliverText: async () => ({ ok: true, text: "桩" }) });
let captured = "";
svc.act = async (prompt: string) => {
  captured = prompt;
  return "途径：算了";
};
await svc.think({ name: "阿牙易", kind: "person", memories: ["上次说要给我起外号"], related: [], repeats: 0 });
const personLine = captured.split("\n").find((l) => l.includes("这次想到的是一个人")) ?? "(没找到)";
console.log(`\nD 提示词里想到人时的引导：\n  ${personLine}`);
await svc.think({ name: "露营", kind: "event", memories: ["约定周六下午"], related: [], repeats: 0 });
const eventHas = captured.includes("这次想到的是一个人");
console.log(`D 想到事时：${eventHas ? "✗ 也加了人的引导" : "✓ 没有加（只在想到人时加）"}`);
svc.close();
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(f)) rmSync(f);
