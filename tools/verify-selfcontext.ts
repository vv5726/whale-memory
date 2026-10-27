/**
 * 验证两件事：
 * ① 走神「说」的话，进不进得了聊天的上下文
 *    （症状：它自己问「排序脚本那边…」，你顺着回，它答「我什么时候要过这个」）
 * ② 抖音从走神那条路上拿掉了：提示词不提，手机工具层直接拦
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BotService } from "../src/bot/service.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { buildChatPrompt } from "../src/bot/persona.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { registerPhoneTools, isDouyin } from "../src/tools/phone.ts";

const tmpDir = "data/tmp-selfcontext";
const tmpDb = join(tmpDir, "memory.db");
const said = "排序脚本那事，deepseek 跟你聊过了吗？我这边随时能写，别让它一直挂着。";

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  copyFileSync("data/memory.db", tmpDb);
  for (const f of ["tuning.json", "thoughts.json", "knowledge.json", "self.md"]) {
    if (existsSync(join("data", f))) copyFileSync(join("data", f), join(tmpDir, f));
  }

  const cfg = {
    ...loadBotConfig(),
    dataDir: tmpDir,
    memoryDb: tmpDb,
    toolsEnabled: false,
  };
  const seen: Array<Array<{ role: string; content: string }>> = [];
  const adapter = {
    complete: async (messages: Array<{ role: string; content: string }>) => {
      seen.push(messages);
      return "目的：跟他说一句\n途径：聊天\n消息：排序脚本那事还挂着吗";
    },
  } as never;

  // 聊天用一个实例，走神用另一个实例（线上就这么分的）
  const chatSvc = new BotService(cfg, { replyAdapter: adapter });
  const autoSvc = new BotService(cfg, { replyAdapter: adapter });
  const historyFor = (svc: BotService, s: string) =>
    (svc as unknown as { historyFor: (x: string) => Array<{ role: "user" | "assistant"; text: string; speaker?: string }> })
      .historyFor(s);

  // ① 先让聊天实例把历史缓存热起来（线上是连着聊了几句之后）
  console.log("=== ① 走神说的话进不进上下文 ===");
  const warm = historyFor(chatSvc, "他-session");
  check("聊天实例的历史是热的（缓存已填）", warm.length > 0, `${warm.length} 条`);
  // 真实库里本来就有一条同文的话（它当时真的说过），所以看「多了一条」而不是「有且只有一条」
  const before = warm.filter((h) => h.role === "assistant" && h.text === said).length;

  // 走神决定找他说话 → thinkOnce 里会调 recordSaid
  // 直接数库：历史窗口只有 50 轮，老的同文消息会被挤出去，不能拿「窗口里的条数」当基准
  const dbOf = (svc: BotService) => (svc as unknown as { db: { prepare: (s: string) => { get: (...a: unknown[]) => { c: number } } } }).db;
  const dbCount = () => Number(dbOf(chatSvc).prepare("SELECT COUNT(*) c FROM turns WHERE text = ?").get(said).c);
  const beforeDb = dbCount();
  autoSvc.recordSaid(said);

  const after = historyFor(chatSvc, "他-session");
  check("这句真的落进 turns 表了", dbCount() === beforeDb + 1, `${beforeDb} → ${dbCount()} 条`);
  check("而且它就是历史最后一条（紧接着的上下文）", after[after.length - 1]?.text === said);

  const msgs = buildChatPrompt({
    memory: { contextBlock: "（记忆）" },
    userName: "他",
    history: after as never,
    message: "你要什么排序脚本",
    memoryWeak: false,
    selfText: "",
  });
  const all = msgs.map((m) => m.content).join("\n");
  check("拼进 prompt 后也看得到（你能顺着它那句回）", msgs.some((m) => m.content === said), `出现 ${count(all, said)} 次`);
  check("这句不是靠当前消息混进来的", msgs[msgs.length - 1]?.content !== said);

  // ② 抖音
  console.log("\n=== ② 抖音从走神那条路拿掉 ===");
  seen.length = 0;
  await autoSvc.think({ name: "他", kind: "人", memories: ["他今天在修记忆层"] });
  const thinkPrompt = seen.flat().map((m) => m.content).join("\n");
  check("走神提示词里没有抖音", !thinkPrompt.includes("抖音"), thinkPrompt.includes("抖音") ? "还有" : "");
  check("走的还是 B 站那条（内容途径还在）", thinkPrompt.includes("B 站"));

  const reg = new ToolRegistry();
  registerPhoneTools(reg, { adbPath: "adb", shotDir: tmpDir });
  const openDouyin = await reg.call("phone_open_app", { package: "com.ss.android.ugc.aweme" });
  check("phone_open_app 拦抖音", openDouyin.ok === false && openDouyin.text.includes("不看抖音"), openDouyin.text);
  const tapDouyin = await reg.call("phone_tap_text", { text: "抖音" });
  check("phone_tap_text 点「抖音」拦掉", tapDouyin.ok === false && tapDouyin.text.includes("不看抖音"), tapDouyin.text);
  check("isDouyin 认包名和中文", isDouyin("com.ss.android.ugc.aweme") && isDouyin("抖音") && !isDouyin("B站"));
  const described = reg
    .schema()
    .map((t) => t.function.description)
    .join("\n");
  check("手机工具说明里也不提抖音了", !described.includes("抖音"));

  chatSvc.close();
  autoSvc.close();
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
