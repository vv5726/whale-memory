/**
 * 验证「B 站学习」这条链真的把内容落到自己身上：
 *   A 额度 0 = 不限（不再误报「今天还能读 0 个」）
 *   B 阅读员拿到「我的处境」，并被要求标出【跟我们有关】
 *   C 主对话按四个问题想，并要求 kb_add / learn
 *   D 读到的条目必须进知识库（不是只记流水账）
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BotService } from "../src/bot/service.ts";
import { AutonomyLoop } from "../src/bot/autonomy.ts";
import { ReaderAgent } from "../src/bot/reader.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { loadBotConfig } from "../src/bot/config.ts";

const tmpDir = "data/tmp-bili-learn";
const tmpDb = join(tmpDir, "memory.db");

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  copyFileSync("data/memory.db", tmpDb);
  for (const f of ["tuning.json", "self.md", "speech-rules.md"]) {
    if (existsSync(join("data", f))) copyFileSync(join("data", f), join(tmpDir, f));
  }
  if (!existsSync(join(tmpDir, "self.md"))) {
    // 没有就用一份假的，验证「处境」真的被拼进去
    (await import("node:fs")).writeFileSync(join(tmpDir, "self.md"), "# 我\n\n## 我是谁\n我叫凝，正在做一套记忆系统。\n", "utf8");
  }

  const cfg = {
    ...loadBotConfig(),
    dataDir: tmpDir,
    memoryDb: tmpDb,
    toolsEnabled: false,
    biliDailyVideoQuota: 0, // ← 0 的本意是「不限」
    autonomyDailyRounds: 0,
  };
  const svc = new BotService(cfg, { replyAdapter: { complete: async () => "记下了" } as never });
  const loop = new AutonomyLoop(cfg, svc, () => {});
  const priv = loop as unknown as Record<string, () => string>;

  console.log("=== A 额度 0 = 不限 ===");
  const budget = svc.autonomyBudget();
  console.log(`  videoUnlimited=${budget.videoUnlimited} videoLeft=${budget.videoLeft} videoUsed=${budget.videoUsed}`);
  check("videoLimit=0 被判成不限", budget.videoUnlimited === true);
  check("videoLeft 不再是 0（不会误报没额度）", budget.videoLeft > 1000, String(budget.videoLeft));

  console.log("\n=== B 阅读员带着「我的处境」 ===");
  const readTask = priv.buildReadTask!();
  console.log(readTask.split("\n").slice(0, 6).map((l) => `  ${l}`).join("\n"));
  check("任务里带了我正在做的事/我是谁", readTask.includes("我是谁") || readTask.includes("我正在做的事"));
  check("任务里说了不限次数（不再说 0 个）", readTask.includes("不限次数"), readTask.includes("0 个") ? "还有 0 个" : "");
  const loopless = new ReaderAgent(cfg, new ToolRegistry());
  const captured: Array<Array<{ role: string; content: string }>> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    captured.push((JSON.parse(String(init?.body ?? "{}")) as { messages: Array<{ role: string; content: string }> }).messages);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "【读了】BV1abc123456 标题 —— 要点" } }] }),
    } as unknown as Response;
  }) as typeof fetch;
  try {
    await loopless.read(readTask);
  } finally {
    globalThis.fetch = realFetch;
  }
  const readerSys = String(captured[0]?.[0]?.content ?? "");
  const readerUser = String(captured[0]?.[1]?.content ?? "");
  check("阅读员规则里有【跟我们有关】", readerSys.includes("【跟我们有关】"));
  check("阅读员真的收到了处境", readerUser.includes("我是谁") || readerUser.includes("我正在做的事"));

  console.log("\n=== C 四个问题 + D 落库 ===");
  const learnPrompt = (loop as unknown as { buildLearnPrompt: (s: string, n: number) => string }).buildLearnPrompt("【读了】BV1abc123456 标题 —— 要点", 1);
  const asks = ["这跟我的目的有什么关系", "我能学到什么", "这对我是好的吗", "我要怎么做"];
  for (const q of asks) check(`四问里有「${q}」`, learnPrompt.includes(q));
  check("要求用 kb_add 记进知识库", learnPrompt.includes("kb_add"));
  check("要求新词进词库（learn）", learnPrompt.includes("learn"));
  check("没有学到就直说，不凑", learnPrompt.includes("今天没学到"));

  const before = existsSync(join(tmpDir, "knowledge.json"))
    ? (JSON.parse(readFileSync(join(tmpDir, "knowledge.json"), "utf8")).entries as unknown[]).length
    : 0;
  const r1 = svc.rememberLearned("BV1btH36uEru 为什么你的DeepSeek和别人不一样 —— 讲模型/Agent/Harness 三层关系");
  const after1 = JSON.parse(readFileSync(join(tmpDir, "knowledge.json"), "utf8")).entries as Array<{ category: string; title: string }>;
  console.log(`  第一次：${JSON.stringify(r1)}，知识库 ${before} → ${after1.length}`);
  check("真的写进知识库了", after1.length === before + 1);
  check("分类是「B站」", after1[after1.length - 1]?.category === "B站", after1[after1.length - 1]?.category);
  check("标题里带了标题本身", (after1[after1.length - 1]?.title ?? "").includes("DeepSeek"));

  svc.rememberLearned("BV1btH36uEru 为什么你的DeepSeek和别人不一样 —— 讲模型/Agent/Harness 三层关系");
  const after2 = JSON.parse(readFileSync(join(tmpDir, "knowledge.json"), "utf8")).entries as unknown[];
  check("同一条重复读不会堆两条（按分类+标题去重）", after2.length === after1.length, `${after1.length} → ${after2.length}`);

  svc.close();
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
