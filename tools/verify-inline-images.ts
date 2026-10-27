/**
 * 验证「当前消息带原图、历史只留描述」：
 *  ① 起一个假模型服务，记录每次请求的 messages
 *  ② 造一条带 CQ 图片的群消息，真跑 service.handle（真实入口）
 *  ③ 断言：有一次请求的最后一条 user content 是数组、里面有 image_url
 *  ④ 断言：数据库里存的那条对话是文字描述，不是 base64
 *  ⑤ 断言：没有挂图时消息退回纯字符串
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BotService } from "../src/bot/service.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { setPendingImages, clearPendingImages } from "../src/bot/pending-images.ts";
import { runChatWithTools } from "../src/llm/toolchat.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { openDb } from "../src/db.ts";

const tmpDir = "data/tmp-immsg";
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

const stickerDirPath = "data/stickers";
const stickerName = readdirSync(stickerDirPath).find((n) => n.endsWith(".jpg"));
const imageBuf = stickerName ? readFileSync(join(stickerDirPath, stickerName)) : null;

const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
const server = createServer((req, res) => {
  if (req.url?.startsWith("/img")) {
    res.writeHead(200, { "content-type": "image/jpeg" });
    res.end(imageBuf ?? Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    requests.push({ path: String(req.url), body });
    res.writeHead(200, { "content-type": "application/json" });
    // 描述层/意思层/回话都返回一句可辨认的话
    res.end(JSON.stringify({ choices: [{ message: { content: "（假模型）这是图中描述的句子。" } }] }));
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const base = loadBotConfig();
  const cfg = {
    ...base,
    dataDir: tmpDir,
    memoryDb: join(tmpDir, "memory.db"),
    deepseekBaseUrl: `http://127.0.0.1:${port}`,
    deepseekApiKey: "test-key",
    toolsEnabled: false,
    allowPrivate: [10000001],
    allowGroups: [],
    idleSleepMinutes: 999,
    dailySleepHour: null,
    autonomyEnabled: false,
    proactiveEnabled: false,
  };

  const svc = new BotService(cfg, {});
  const evt = {
    sessionId: "private:10000001",
    userId: 10000001,
    userName: "测试",
    text: `[CQ:image,file=abc.jpg,url=http://127.0.0.1:${port}/img.jpg] 这图好看吗`,
    isGroup: false,
    selfId: base.selfId,
  };
  const reply = await svc.handle(evt);

  console.log("=== 请求概览 ===");
  for (const r of requests) {
    const msgs = (r.body.messages ?? []) as Array<{ role: string; content: unknown }>;
    const last = msgs[msgs.length - 1];
    const kind = Array.isArray(last?.content) ? `数组(${(last.content as unknown[]).length} 段)` : "字符串";
    console.log(`  ${r.path}  消息 ${msgs.length} 条，最后一条 ${last?.role} content=${kind}`);
  }

  const withArray = requests.some((r) => {
    const msgs = (r.body.messages ?? []) as Array<{ role: string; content: unknown }>;
    return msgs.some((m) => Array.isArray(m.content) && JSON.stringify(m.content).includes("image_url"));
  });
  check("有一次请求带上了原图（image_url）", withArray);
  check("回复不为空", typeof reply === "string" && reply.length > 0, String(reply).slice(0, 30));

  const db = openDb(cfg.memoryDb);
  const turns = db.prepare("SELECT text FROM turns WHERE role = 'user' ORDER BY seq DESC LIMIT 1").all() as Array<{ text: string }>;
  const stored = turns[0]?.text ?? "";
  check("库里存的是文字描述（不是 base64）", stored.length > 0 && !stored.includes("base64") && stored.length < 600, stored.slice(0, 60));
  db.close();

  // ⑤ 没挂图时退回字符串
  clearPendingImages();
  const before = requests.length;
  await runChatWithTools(
    { baseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m" },
    [
      { role: "system", content: "sys" },
      { role: "user", content: "普通一句话" },
    ],
    new ToolRegistry(),
  );
  const lastReq = requests[before];
  const lastMsg = (lastReq.body.messages as Array<{ content: unknown }>).at(-1);
  check("没有挂图时 content 是字符串", typeof lastMsg?.content === "string", String(lastMsg?.content));

  // 再验证一次：挂图后第二次调用不再带图（注入一次就清空）
  clearPendingImages();
  const imgFile = readdirSync("data/stickers").find((n) => n.endsWith(".jpg"));
  setPendingImages([join("data/stickers", imgFile ?? "")]);
  const msg = [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "看这张" },
  ];
  const mark = requests.length;
  await runChatWithTools({ baseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m" }, msg, new ToolRegistry());
  await runChatWithTools({ baseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m" }, msg, new ToolRegistry());
  const first = (requests[mark].body.messages as Array<{ content: unknown }>).at(-1);
  const second = (requests[mark + 1].body.messages as Array<{ content: unknown }>).at(-1);
  check("第一次调用带图", Array.isArray(first?.content));
  check("第二次调用不带图（不重复烧 token）", typeof second?.content === "string");

  svc.close();
} finally {
  server.close();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
