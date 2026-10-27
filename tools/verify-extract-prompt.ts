// 一次性验收：抽取提示词三条路 + 场景名单（私聊/群聊）+ 新工具 + speakUp 提示词
import { existsSync, copyFileSync, rmSync } from "node:fs";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { registerExtractRulesTools } from "../src/tools/extract-rules.ts";
import { buildMessages } from "../src/llm/extract.ts";
import { checkPromptTemplate, renderPrompt, DEFAULT_PROMPT_TEMPLATE, promptPath } from "../src/extract-prompt.ts";

const names = { user: "他（10001）", assistant: "凝" };
const turns = [
  { role: "user", text: "在吗" },
  { role: "assistant", text: "在" },
];

console.log("=== ① 默认模板渲染 ===");
const sys = buildMessages("2026-10-27", turns, names, ["B站", "记忆"])[0].content;
console.log(sys.split("\n").slice(1, 5).join("\n"));
console.log("含「这批对话」:", sys.includes("这批对话"), "| 含 {{ }} 残留:", /\{\{/.test(sys));

console.log("\n=== ② 校验函数 ===");
console.log("缺结构键:", checkPromptTemplate("随便写点什么，反正没有结构键，长度够长的话应该只报缺少键的问题。".repeat(3)));
console.log("正常模板:", checkPromptTemplate(DEFAULT_PROMPT_TEMPLATE));
console.log("错占位符:", checkPromptTemplate(DEFAULT_PROMPT_TEMPLATE.replace("{{anchors}}", "{{anchor}}")));

console.log("\n=== ③ 写一份自定义模板，看是否生效，再删掉 ===");
const p = promptPath("data");
const backup = existsSync(p) ? `${p}.tmpbak` : null;
if (backup) copyFileSync(p, backup);
const { savePromptTemplate } = await import("../src/extract-prompt.ts");
savePromptTemplate("data", "自定义版：{{turns}} 轮 {{chars}} 字，user={{user}}，anchors={{anchors}}。events/title/detail/my_view 都要有。");
const sys2 = buildMessages("2026-10-27", turns, names, ["B站"])[0].content;
console.log("生效了吗:", sys2.startsWith("自定义版："));
console.log("渲染结果:", sys2.split("\n")[0]);
savePromptTemplate("data", null);
console.log("删掉后回到原版:", buildMessages("2026-10-27", turns, names, [])[0].content.includes("你是记忆抽取器"));
if (backup) {
  copyFileSync(backup, p);
  rmSync(backup);
}

console.log("\n=== ④ 工具注册 ===");
const reg = new ToolRegistry();
registerExtractRulesTools(reg, { dataDir: "data" });
console.log("注册的工具:", reg.names().join(", "));

console.log("\n=== ⑤ 场景：私聊 / 群聊（真跑 handle + say，respond 打桩）===");
for (const f of ["data/tmp-verify2.db", "data/tmp-verify2.db-wal", "data/tmp-verify2.db-shm"]) {
  if (existsSync(f)) rmSync(f);
}
copyFileSync("data/memory.db", "data/tmp-verify2.db");
const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/tmp-verify2.db" });
let last = null;
svc.respond = async (messages) => {
  last = messages;
  return { text: "（打桩）", toolText: "" };
};
const sceneLine = () =>
  last
    .map((m) => m.content)
    .join("\n")
    .split("\n")
    .filter((l) => l.includes("群号") || l.includes("只有你和他"))
    .join(" | ");

await svc.handle({
  userId: 10001, selfId: cfg.selfId, userName: "他", text: "在吗",
  isGroup: false, mentioned: false, sessionId: "10001",
} as never);
console.log("handle 私聊 →", sceneLine());

await svc.handle({
  userId: 10001, selfId: cfg.selfId, userName: "他", text: "在吗",
  isGroup: true, groupId: 987654321, mentioned: true, sessionId: "g:987654321:1",
} as never);
console.log("handle 群聊 →", sceneLine());

await svc.say("在吗", "他", { isGroup: true, groupId: 987654321 } as never);
console.log("say   群聊 →", sceneLine());

console.log("\n=== ⑥ speakUp 提示词（把 act 打桩，直接把拼出来的东西打出来）===");
svc.act = async (text) => {
  console.log(text);
  return "沉默";
};
await svc.speakUp({ idleMinutes: 40, used: 1, limit: 3 });

svc.close();
for (const f of ["data/tmp-verify2.db", "data/tmp-verify2.db-wal", "data/tmp-verify2.db-shm"]) {
  if (existsSync(f)) rmSync(f);
}
