// 验证「阅读」这条管道被摘出来之后还完整：
//   A 简报拆条目（两种写法都认）
//   B 派给阅读员的任务带了「为什么看」和「我的处境」
//   C 学习轮的四问 / kb_add / learn 都还在
//   D 端到端：读 → 简报 → 落条目 → 学，且【学习轮只看到简报，看不到原文】
//   E 没有阅读员时不炸，返回 ok:false
//
// 不花钱：fetch 被换掉，按系统提示词分辨「现在是阅读员还是学习轮」。
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { AutonomyLoop } from "../src/bot/autonomy.ts";
import { parseReadItems, Reading } from "../src/bot/reading.ts";

const TMP = "data/tmp-verify-reading";
const DB = join(TMP, "rd.db");

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `　${detail}` : ""}`);
  if (!ok) fail += 1;
};

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
for (const f of ["persona.md", "speech-rules.md", "self.md", "tuning.json", "knowledge.json"]) {
  if (existsSync(join("data", f))) copyFileSync(join("data", f), join(TMP, f));
}
if (!existsSync(join(TMP, "self.md"))) {
  writeFileSync(join(TMP, "self.md"), "# 我\n\n## 我是谁\n我叫凝，在做一个记忆系统。\n", "utf8");
}
copyFileSync("data/memory.db", DB);

// ── A 简报拆条目 ──
console.log("=== A 简报拆条目 ===");
const oneLine = "【读了】BV1aaa 标题一 —— 要点一\n【读了】BV1bbb 标题二 —— 要点二\n【跳过】标题党";
const bullets = "【读了】\n- BV1ccc 标题三 —— 要点三\n- BV1ddd 标题四 —— 要点四\n【值得聊】BV1ccc 理由是啥";
const a1 = parseReadItems(oneLine);
const a2 = parseReadItems(bullets);
check("一行一条认得出来", a1.length === 2, JSON.stringify(a1));
check("【读了】+ 列表也认得出来", a2.length >= 3, JSON.stringify(a2));
check("最多取 10 条", parseReadItems(Array.from({ length: 30 }, (_, i) => `【读了】BV${i} 标题`).join("\n")).length === 10);

// ── 造服务 ──
const cfg = {
  ...loadBotConfig(),
  dataDir: TMP,
  memoryDb: DB,
  toolsEnabled: true,
  deepseekApiKey: "k",
  biliDailyVideoQuota: 0,
};
const svc = new BotService(cfg);
const loop = new AutonomyLoop(cfg, svc, () => {});
const reading: Reading = loop.reading;

// ── B 阅读任务 ──
console.log("\n=== B 派给阅读员的任务 ===");
const task = reading.buildTask({ why: "想起「王建国欠钱」", focus: "有没有讲催债的" });
check("带了「为什么去看」", task.includes("为什么去看：想起「王建国欠钱」"));
check("带了「重点看」", task.includes("重点看：有没有讲催债的"));
check("带了处境（我是谁 / 我正在做的事）", task.includes("我是谁") || task.includes("我正在做的事"));

// ── C 学习轮 ──
console.log("\n=== C 学习轮的四问 ===");
const learn = reading.buildLearnPrompt("【读了】BV1aaa 标题 —— 要点", 2);
for (const q of ["这跟我的目的有什么关系", "我能学到什么", "这对我是好的吗", "我要怎么做"]) {
  check(`四问里有「${q}」`, learn.includes(q));
}
check("要求 kb_add 记知识库", learn.includes("kb_add"));
check("要求新词进词库（learn）", learn.includes("learn"));
check("提示已自动入库几条", learn.includes("其中 2 条已经自动收进知识库"));
check("没学到就直说", learn.includes("今天没学到"));

// ── D 端到端（换掉 fetch）──
console.log("\n=== D 端到端：读 → 简报 → 落条目 → 学 ===");
const BRIEF = [
  "【读了】BV1test 一条假视频 —— 讲的是怎么把字幕挡在主上下文外面",
  "【值得聊】BV1test —— 因为它就在测这条链路",
].join("\n");
const noted: string[] = [];
const origNote = svc.recordNote.bind(svc);
(svc as unknown as { recordNote: (t: string) => void }).recordNote = (t: string) => {
  noted.push(t);
  origNote(t);
};

const calls: Array<{ phase: string; system: string; user: string }> = [];
globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    messages?: Array<{ role?: string; content?: string }>;
  };
  const system = String(body.messages?.[0]?.content ?? "");
  const user = String(body.messages?.[body.messages.length - 1]?.content ?? "");
  const isReader = system.includes("你是阅读员");
  calls.push({ phase: isReader ? "reader" : "learn", system, user });
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: isReader ? BRIEF : "学到了：字幕别进主上下文。" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as unknown as typeof fetch;

const r = await reading.run({ why: "验证用：想起一个锚点" });
check("run 成功", r.ok, r.reason);
check("简报原样返回", r.summary === BRIEF, `${r.summary.length} 字`);
check("拆出了条目", r.items.length === 2, JSON.stringify(r.items));
check("条目都落了 note", noted.filter((n) => n.startsWith("读到的：")).length === 2, String(noted.length));
check("学习轮说了话", r.said.includes("学到了"));

const learnCall = calls.find((c) => c.phase === "learn");
check("学习轮真的跑了", Boolean(learnCall));
check("学习轮看得到简报", Boolean(learnCall?.user.includes(BRIEF)));
// 隔离：学习轮的输入应当 ≈ 简报 + 固定模板，不能出现「整篇原文」那种量级
const overhead = (learnCall?.user.length ?? 0) - BRIEF.length - (learnCall?.system.length ?? 0);
check("学习轮输入里没有多出大段原文", overhead < 1200, `多出 ${overhead} 字`);

// ── E 没有阅读员 ──
console.log("\n=== E 没有阅读员 ===");
const bare = new Reading(cfg, svc, null);
check("hasReader() = false", bare.hasReader() === false);
const r2 = await bare.run({ why: "x" });
check("run 返回 ok:false 而不是抛异常", r2.ok === false && r2.reason.length > 0, r2.reason);

svc.close();
for (const p of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(p)) rmSync(p);
rmSync(TMP, { recursive: true, force: true });

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
