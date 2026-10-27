/**
 * 验证「走神说的话发给了谁」：
 *  ① resolveSpeakTarget：群聊 → 群；私聊 → 那个人；没最近会话 → 主人
 *  ② 会话过期（>15 分钟）→ 回落到主人
 *  ③ 真跑 handle（群消息）后，think 的提示词里点明「刚才是在群里跟某甲说话」
 *  ④ 走神里 channel=聊天 时，投递目标是那个群，而不是主人
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { noteChatTarget, lastChatTarget, resolveSpeakTarget } from "../src/bot/last-chat.ts";
import { BotService } from "../src/bot/service.ts";
import { loadBotConfig } from "../src/bot/config.ts";

const OWNER = 10001;
const GIRL = 10003;
const GROUP = 20001;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

console.log("=== ① 目标解析 ===");
check("群聊里 → 发群", (() => {
  const t = resolveSpeakTarget({ isGroup: true, groupId: GROUP, userId: GIRL, userName: "虔诚", at: Date.now() }, OWNER);
  return t.kind === "group" && t.id === GROUP;
})());
check("私聊里 → 发那个人", (() => {
  const t = resolveSpeakTarget({ isGroup: false, userId: GIRL, userName: "虔诚", at: Date.now() }, OWNER);
  return t.kind === "private" && t.id === GIRL;
})());
check("没最近会话 → 发主人", (() => {
  const t = resolveSpeakTarget(null, OWNER);
  return t.kind === "private" && t.id === OWNER;
})());
check("群里但没 groupId（异常兜底）→ 私聊那个人", (() => {
  const t = resolveSpeakTarget({ isGroup: true, userId: GIRL, userName: "虔诚", at: Date.now() }, OWNER);
  return t.kind === "private" && t.id === GIRL;
})());

console.log("\n=== ② 会话过期 ===");
noteChatTarget({ isGroup: true, groupId: GROUP, userId: GIRL, userName: "虔诚" });
check("刚记的能拿到", lastChatTarget()?.groupId === GROUP);
check("超过 15 分钟当作没有", lastChatTarget(15 * 60_000, Date.now() + 16 * 60_000) === null);

const tmpDir = "data/tmp-speaktarget";
try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const base = loadBotConfig();
  const cfg = {
    ...base,
    dataDir: tmpDir,
    memoryDb: join(tmpDir, "memory.db"),
    deepseekBaseUrl: "http://127.0.0.1:59996",
    deepseekApiKey: "k",
    toolsEnabled: false,
    autonomyEnabled: false,
    proactiveEnabled: false,
    allowPrivate: [OWNER, GIRL],
    allowGroups: [GROUP],
  };
  const captured: string[] = [];
  const svc = new BotService(cfg, {
    replyAdapter: {
      name: "cap",
      complete: async (messages: Array<{ role: string; content: string }>) => {
        captured.push(messages.map((m) => m.content).join("\n"));
        return "目的：问问她\n途径：聊天\n消息：刚才是不是我催太紧了？";
      },
    } as never,
  });

  console.log("\n=== ③ 群聊之后，走神知道在跟谁说话 ===");
  await svc.handle({
    sessionId: `group:${GROUP}:user:${GIRL}`,
    userId: GIRL,
    userName: "虔诚",
    text: "我去睡了",
    isGroup: true,
    groupId: GROUP,
    selfId: base.selfId,
  });
  check("记下了最近的群会话", lastChatTarget()?.groupId === GROUP && lastChatTarget()?.userId === GIRL);
  captured.length = 0;
  await svc.think({ name: "睡觉", kind: "event", memories: ["她说过要去睡"], related: [], repeats: 0 }).catch(() => {});
  const thinkPrompt = captured.join("\n");
  check("提示词里点明了最近会话（群里 虔诚）", thinkPrompt.includes("【刚才在跟谁说话】") && thinkPrompt.includes("群里虔诚"));
  check("并且要求人称关系别搞错", thinkPrompt.includes("人称、关系别搞错"));

  console.log("\n=== ④ 这时候开口 → 发到那个群 ===");
  const t = resolveSpeakTarget(lastChatTarget(), OWNER);
  check("目标变成群，不再是主人", t.kind === "group" && t.id === GROUP, `${t.kind}:${t.id}`);

  svc.close();
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
