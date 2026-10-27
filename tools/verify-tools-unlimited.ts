/**
 * 验证两件事：
 *   ① 工具轮次不再有上限（0 = 不限）：模型想连着调 12 轮就 12 轮
 *   ② 眼睛没起来时，别把原因吞成「图很糊」
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runChatWithTools } from "../src/llm/toolchat.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { describeImagesInText } from "../src/vision.ts";
import { loadTuning } from "../src/tuning.ts";

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

// ── ① 工具轮次不限 ──
console.log("=== ① 工具轮次 ===");
const reg = new ToolRegistry();
let called = 0;
reg.register({
  name: "fake_tool",
  description: "测试用",
  parameters: { type: "object", properties: { n: { type: "integer" } } },
  handler: async (args) => {
    called++;
    return { ok: true, text: `第 ${String(args.n ?? "?")} 次` };
  },
});

const ROUNDS = 12;
let apiCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
  apiCalls++;
  const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string }> };
  const rounds = (body.messages ?? []).filter((m) => m.role === "tool").length;
  if (rounds < ROUNDS) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        usage: { prompt_tokens: 10, completion_tokens: 2 },
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: `c${rounds}`, type: "function", function: { name: "fake_tool", arguments: JSON.stringify({ n: rounds + 1 }) } }],
            },
          },
        ],
      }),
    } as unknown as Response;
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      usage: { prompt_tokens: 10, completion_tokens: 2 },
      choices: [{ message: { content: "办完了" } }],
    }),
  } as unknown as Response;
}) as typeof fetch;

try {
  const out = await runChatWithTools(
    { baseUrl: "http://fake", apiKey: "k", model: "m" },
    [{ role: "user", content: "帮我办 12 件事" }],
    reg,
    0, // 0 = 不限
  );
  console.log(`  真的调了 ${called} 轮工具，API 往返 ${apiCalls} 次，回复：${out.text}`);
  check("不限轮次时能连着调 12 轮（旧上限 4）", called === ROUNDS, `${called} 轮`);
  check("最后拿到了正常回复", out.text === "办完了");
  check("tuning 默认是 0（不限）", loadTuning("data").maxToolRounds === 0, String(loadTuning("data").maxToolRounds));

  // 显式给上限时仍然生效（想刹车还能刹车）
  called = 0;
  apiCalls = 0;
  await runChatWithTools({ baseUrl: "http://fake", apiKey: "k", model: "m" }, [{ role: "user", content: "x" }], reg, 3);
  check("显式给上限 3 时仍然会在 3 轮停", called === 3, `${called} 轮`);
} finally {
  globalThis.fetch = realFetch;
}

// ── ② 眼睛没起来时说真话 ──
console.log("\n=== ② 看图失败时说清原因 ===");
const dataDir = "data/tmp-vision-honest";
mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, "bot.json"), JSON.stringify({ deepseekApiKey: "test-key" }), "utf8");

const bytes = Buffer.from("fake");
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(typeof input === "object" && "url" in input ? (input as Request).url : input);
  if (url.includes("/api/generate")) return { ok: false, status: 502, json: async () => ({}) } as unknown as Response;
  if (url.includes("/chat/completions")) {
    // 现在看图的**首选**是 DeepSeek 多模态：要测「看图失败说真话」，就得让它也失败
    return { ok: false, status: 500, text: async () => "vision boom" } as unknown as Response;
  }
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(0) } as unknown as Response;
}) as typeof fetch;

try {
  const out = await describeImagesInText(
    "看这个 [CQ:image,file=a.png,url=http%3A%2F%2Fx%2Fa.png,summary=动画表情]",
    dataDir,
  );
  console.log(`  她看到的：${out}`);
  check("说的是「看图没成功」而不是「太糊」", out.includes("看图没成功") || out.includes("没用") || out.includes("看图"));
  check("带了具体原因（DeepSeek 或本地）", out.includes("本地模型报错") || out.includes("眼睛") || out.includes("DeepSeek") || out.includes("本地也没看成"));
} finally {
  globalThis.fetch = realFetch;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
