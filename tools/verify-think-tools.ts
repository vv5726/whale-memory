/**
 * 验证「走神提示词可编辑 + 旋钮可调 + 提示词内容按他要求改了」：
 *  ① think-prompt.md 的读/写/重置
 *  ② 八问、三途径、消息模板、重复锚点那句都在
 *  ③ 真跑 service.think()：抓到的请求里没有乱码、有那八问、有「还要继续吗」
 *  ④ 旋钮：读/写/越界收敛，且 autonomy 真的读 tuning
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ToolRegistry } from "../src/tools/registry.ts";
import { registerThinkTools } from "../src/tools/think.ts";
import { DEFAULT_THINK_PROMPT, loadThinkPrompt } from "../src/think-prompt.ts";
import { loadTuning, saveTuning } from "../src/tuning.ts";
import { BotService } from "../src/bot/service.ts";
import { loadBotConfig } from "../src/bot/config.ts";

const tmpDir = "data/tmp-thinktools";
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  console.log("=== ① 提示词读写 ===");
  const reg = new ToolRegistry();
  registerThinkTools(reg, { dataDir: tmpDir });
  const r1 = await reg.call("think", { action: "prompt_get" });
  check("能读到默认模板", r1.ok && r1.text.includes("静下来时"), "");
  check("模板里有八问", r1.text.includes("我的情绪怎么样") && r1.text.includes("某个人的情绪怎么样"));
  check("模板里有三途径 + 消息模板", r1.text.includes("找人聊天") && r1.text.includes("胡言乱语说一个梗"));
  const w = await reg.call("think", { action: "prompt_set", text: "【我自己写的】\n" + "x".repeat(200) });
  check("能写新模板", w.ok, w.text);
  check("文件落盘", readFileSync(join(tmpDir, "think-prompt.md"), "utf8").includes("我自己写的"));
  const short = await reg.call("think", { action: "prompt_set", text: "太短" });
  check("太短被拒", short.ok === false);
  const rs = await reg.call("think", { action: "prompt_reset" });
  check("能恢复默认", rs.ok && loadThinkPrompt(tmpDir) === DEFAULT_THINK_PROMPT.trim());

  console.log("\n=== ② 真跑 think()，看拼出来的提示词 ===");
  const base = loadBotConfig();
  const cfg = {
    ...base,
    dataDir: tmpDir,
    memoryDb: join(tmpDir, "memory.db"),
    deepseekBaseUrl: "http://127.0.0.1:59999",
    deepseekApiKey: "k",
    toolsEnabled: false,
  };
  const captured: Array<Array<{ role: string; content: string }>> = [];
  const svc = new BotService(cfg, {
    replyAdapter: {
      name: "capture",
      complete: async (messages: Array<{ role: string; content: string }>) => {
        captured.push(messages);
        return "目的：测试\n途径：算了\n消息：";
      },
    } as never,
  });
  await svc.think({ name: "某人", kind: "人", memories: ["说过要学小甜妹语录"], related: [], repeats: 3 }).catch(() => "");
  const prompt = captured[0]?.map((m) => m.content).join("\n") ?? "";
  check("提示词里带锚点名", prompt.includes("某人"));
  check("带了重复提醒（还要继续吗）", prompt.includes("还要继续吗"));
  check("带了八问（新增的 7、8）", prompt.includes("我的情绪怎么样") && prompt.includes("某个人的情绪怎么样"));
  check("带了三途径和消息模板", prompt.includes("找人聊天") && prompt.includes("我刚刚想到"));
  check("没有乱码字符", !/[\uFFFD]/.test(prompt), /[\uFFFD]/.test(prompt) ? "还有替换字符" : "");
  svc.close();

  console.log("\n=== ③ 旋钮 ===");
  saveTuning(tmpDir, { thinkIdleSeconds: 30, thinkSettleSeconds: 90, thinkChance: 0.85, thinkGapMinMinutes: 1.5, thinkGapMaxMinutes: 3.5 });
  const kr = await reg.call("think", { action: "knobs_get" });
  check("能读旋钮", kr.ok && kr.text.includes("thinkChance"));
  const kw = await reg.call("think", { action: "knobs_set", thinkChance: 0.5, thinkIdleSeconds: 10 });
  check("能改旋钮", kw.ok && loadTuning(tmpDir).thinkChance === 0.5 && loadTuning(tmpDir).thinkIdleSeconds === 10, kw.text.split("\n")[1]);
  const over = await reg.call("think", { action: "knobs_set", thinkChance: 9 });
  check("越界收敛到 1", loadTuning(tmpDir).thinkChance === 1 && over.text.includes("超出范围"));
  const empty = await reg.call("think", { action: "knobs_set" });
  check("什么都不传会被拒", empty.ok === false);

  console.log("\n=== ④ autonomy 真的读 tuning ===");
  const autonomySrc = readFileSync("src/bot/autonomy.ts", "utf8");
  check("thinkOnce 用 tune.thinkIdleSeconds", autonomySrc.includes("tune.thinkIdleSeconds"));
  check("thinkOnce 用 tune.thinkSettleSeconds", autonomySrc.includes("tune.thinkSettleSeconds"));
  check("thinkOnce 用 tune.thinkChance", autonomySrc.includes("tune.thinkChance"));
  check("startThinking 读 thinkGapMin/Max", autonomySrc.includes("tune.thinkGapMinMinutes") && autonomySrc.includes("tune.thinkGapMaxMinutes"));
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
