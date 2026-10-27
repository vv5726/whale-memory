// 验证：走神看不到手机工具，聊天 / 自主活动仍然看得到。
//
// 不调真模型：把 fetch 换掉，只截获请求体里的 tools 和系统提示里的【工具】那行。
// 用 data/tmp-verify-think.db（memory.db 的副本），不污染真库。
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const src = "data/memory.db";
const tmp = "data/tmp-verify-think.db";
for (const p of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(p)) rmSync(p);
copyFileSync(src, tmp);

const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: tmp });

interface Captured {
  names: string[];
  promptLine: string;
}
const seen: Captured[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    tools?: Array<{ function?: { name?: string } }>;
    messages?: Array<{ role?: string; content?: unknown }>;
  };
  const names = (body.tools ?? []).map((t) => String(t.function?.name ?? ""));
  const system = String(body.messages?.[0]?.content ?? "");
  const line = /【工具】你能直接操作：([^\n]+)/.exec(system)?.[1] ?? "";
  seen.push({ names, promptLine: line });
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "好" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as unknown as typeof fetch;

let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `　${detail}` : ""}`);
  if (!ok) fail++;
};

async function run(label: string, fn: () => Promise<unknown>): Promise<string[]> {
  seen.length = 0;
  const text = await fn();
  const names = [...new Set(seen.flatMap((s) => s.names))];
  const promptLine = seen[0]?.promptLine ?? "";
  const phoneSchema = names.filter((n) => n.startsWith("phone_"));
  const phonePrompt = promptLine.split("、").filter((n) => n.startsWith("phone_"));
  console.log(
    `\n[${label}] 请求 ${seen.length} 次｜可见工具 ${names.length} 个｜` +
      `手机（schema ${phoneSchema.length} / 提示词 ${phonePrompt.length}）`,
  );
  console.log(`  回的是：${String(text).slice(0, 40) || "(空)"}`);
  return [...phoneSchema, ...phonePrompt];
}

const phoneInThink = await run("think()", () =>
  svc.think({ name: "记忆系统", kind: "event", memories: ["试一下这条链路"] }),
);
check("走神看不到手机工具", phoneInThink.length === 0, phoneInThink.slice(0, 3).join("、"));

const phoneInChat = await run("handle()", () =>
  svc.handle({
    // 用配置里真正的白名单用户：硬编码 QQ 号会在脱敏时被替换掉
    userId: Number(cfg.allowPrivate[0] ?? cfg.selfId),
    selfId: cfg.selfId,
    userName: "他",
    text: "在吗",
    isGroup: false,
    mentioned: false,
    sessionId: String(cfg.allowPrivate[0] ?? cfg.selfId),
  } as never),
);
check("聊天仍然看得到手机工具（手机连着才成立）", phoneInChat.length > 0, `看到 ${phoneInChat.length} 个`);

const phoneInAct = await run("act()", () => svc.act("随便干点什么"));
check("自主活动仍然看得到手机工具", phoneInAct.length > 0, `看到 ${phoneInAct.length} 个`);

globalThis.fetch = realFetch;
svc.close();
for (const p of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(p)) rmSync(p);

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
