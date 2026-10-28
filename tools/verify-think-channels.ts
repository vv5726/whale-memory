// 验证走神的两条执行器（途径=内容 / 途径=做）真的接上了。
//
// 不调真模型：把 fetch 换掉，按系统提示词分辨「现在是哪一步」，返回对应的假回复。
// 数据和日志全在临时目录，不碰线上 data/。
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { AutonomyLoop } from "../src/bot/autonomy.ts";

const TMP = "data/tmp-verify-channels";
const DB = join(TMP, "ch.db");
const SRC_DB = "data/memory.db";

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
for (const f of ["persona.md", "speech-rules.md", "extract-rules.md", "think-prompt.md", "self.md", "knowledge.json", "lexicon.json"]) {
  if (existsSync(join("data", f))) copyFileSync(join("data", f), join(TMP, f));
}
copyFileSync(SRC_DB, DB);
// 走神要 100% 掷中、不等待，才测得到后面的分支
writeFileSync(
  join(TMP, "tuning.json"),
  JSON.stringify({ thinkChance: 1, thinkIdleSeconds: 0, thinkSettleSeconds: 0, thinkGapMinMinutes: 0.3, thinkGapMaxMinutes: 0.6, actRounds: 3 }),
  "utf8",
);

const cfg = {
  ...loadBotConfig(),
  dataDir: TMP,
  memoryDb: DB,
  thinkEnabled: true,
  autonomyEnabled: false,
  autonomyHours: [0, 24] as [number, number],
  deepseekApiKey: "k",
};

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `　${detail}` : ""}`);
  if (!ok) fail += 1;
};

let intent = "内容";
const seen: Array<{ kind: string; tools: string[] }> = [];

globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    tools?: Array<{ function?: { name?: string } }>;
    messages?: Array<{ role?: string; content?: string }>;
  };
  const system = String(body.messages?.[0]?.content ?? "");
  const user = String(body.messages?.[body.messages.length - 1]?.content ?? "");
  const tools = (body.tools ?? []).map((t) => String(t.function?.name ?? ""));

  let reply = "";
  let kind = "";
  if (system.includes("你是阅读员")) {
    kind = "reader";
    reply = "【读了】BV1test 一条假视频 —— 讲的是测试用假数据\n【值得聊】BV1test —— 因为它就在测这条链路";
  } else if (user.includes("刚才你想到一件事")) {
    kind = "act";
    reply = "做完了：把它记进了手记。";
  } else {
    kind = "think";
    reply = `目的：想确认这条路通不通\n途径：${intent}\n消息：`;
  }
  seen.push({ kind, tools });

  return new Response(
    JSON.stringify({
      choices: [{ message: { content: reply }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as unknown as typeof fetch;

const svc = new BotService(cfg);
const loop = new AutonomyLoop(cfg, svc, () => {});

// ① 途径 = 内容：应该派阅读员，并把学到的写进手记
intent = "内容";
const r1 = await loop.thinkOnce();
check("内容：走神返回「去看了一轮」", /看了一轮/.test(r1.reason), r1.reason);
const readerCalled = seen.some((s) => s.kind === "reader");
check("内容：真的调了阅读员", readerCalled);
const readingDir = join(TMP, "reading");
check("内容：简报落盘了", existsSync(readingDir), readingDir);

// ② 途径 = 做：**只记进待办，不立刻动手**（2026-10-28 改的）
intent = "做";
seen.length = 0;
const r2 = await loop.thinkOnce();
check("做：走神返回「记进待办」", /记进待办|记下了/.test(r2.reason + r2.text), r2.reason);

const queueFile = join(TMP, "todo-queue.json");
let queue: Array<{ kind: string; what: string; why: string; status: string }> = [];
try {
  queue = JSON.parse(readFileSync(queueFile, "utf8"));
} catch {
  queue = [];
}
check("做：队列里多了一条", queue.length === 1, `${queue.length} 条`);
check("做：记的是同一件事", Boolean(queue[0]?.what.includes("想确认这条路通不通")), queue[0]?.what ?? "");
check("做：默认算 light", queue[0]?.kind === "light", queue[0]?.kind ?? "");
check("做：没有当场再跑一轮动手", !seen.some((s) => s.kind === "act"));

// 走神只能看到三个工具（这是省钱的关键）
const thinkCall = seen.find((s) => s.kind === "think");
const thinkToolNames = thinkCall?.tools ?? [];
check(
  "走神只拿到 3 个工具",
  thinkToolNames.length === 3 && thinkToolNames.includes("queue_add"),
  thinkToolNames.join("、"),
);

// ③ 手记里两条都要留下痕迹
const jf = join(TMP, "journal");
let journal = "";
try {
  for (const f of readFileSync ? [] : []) void f;
  const { readdirSync } = await import("node:fs");
  const files = existsSync(jf) ? readdirSync(jf) : [];
  for (const f of files) journal += readFileSync(join(jf, f), "utf8");
} catch {
  journal = "";
}
check("手记里有「→ 内容」", /→ 内容/.test(journal));
check("手记里有「→ 做」", /→ 做/.test(journal));

svc.close();
for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });
rmSync(TMP, { recursive: true, force: true });

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
