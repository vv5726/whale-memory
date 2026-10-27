/**
 * QQ 机器人端到端冒烟测试——不需要 QQ，也不需要装 NapCat。
 *
 * 自带一个极简 OneBot WebSocket 服务器（真服务器，真握手，真帧），
 * 用它扮演 NapCat 推消息、收回复，验证整条链路。
 *
 * 用法：node tools/bot-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { Socket } from "node:net";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BotService } from "../src/bot/service.ts";
import { OneBotClient } from "../src/bot/onebot.ts";
import { DEFAULT_BOT_CONFIG, type BotConfig } from "../src/bot/config.ts";
import { pendingTurns } from "../src/sleep.ts";
import type { LlmAdapter } from "../src/llm/adapter.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DB = join(ROOT, "data", "bot-test.db");

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}

// ───────────────────────── 极简 WebSocket 服务器 ─────────────────────────

function encodeFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrames(state: { buf: Buffer }): string[] {
  const out: string[] = [];
  for (;;) {
    const b = state.buf;
    if (b.length < 2) break;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (b.length < 4) break;
      len = b.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (b.length < 10) break;
      len = Number(b.readBigUInt64BE(2));
      offset = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (b.length < offset + maskLen + len) break;
    const mask = masked ? b.subarray(offset, offset + 4) : null;
    const data = Buffer.from(b.subarray(offset + maskLen, offset + maskLen + len));
    if (mask) for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i % 4];
    state.buf = b.subarray(offset + maskLen + len);
    if (opcode === 0x1) out.push(data.toString("utf8"));
  }
  return out;
}

interface MockOneBot {
  port: number;
  server: Server;
  received: string[];
  /** 扮演 NapCat 往客户端推一条事件 */
  push: (event: unknown) => void;
  close: () => void;
}

function startMockOneBot(port: number): Promise<MockOneBot> {
  const state = { socket: null as Socket | null, received: [] as string[] };
  const server = createServer();

  server.on("upgrade", (req, socket) => {
    const key = String(req.headers["sec-websocket-key"] ?? "");
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    state.socket = socket;
    const buf = { buf: Buffer.alloc(0) };
    socket.on("data", (chunk) => {
      buf.buf = Buffer.concat([buf.buf, chunk]);
      for (const text of decodeFrames(buf)) state.received.push(text);
    });
    socket.on("error", () => undefined);
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        port,
        server,
        received: state.received,
        push: (event: unknown) => {
          state.socket?.write(encodeFrame(JSON.stringify(event)));
        },
        close: () => {
          state.socket?.destroy();
          server.close();
        },
      });
    });
  });
}

// ───────────────────────── 测试 ─────────────────────────

function fakeAdapter(reply: string, captured: string[]): LlmAdapter {
  return {
    name: "fake",
    complete: async (messages) => {
      captured.push(messages.map((m) => m.content).join("\n"));
      return reply;
    },
  };
}

function cleanDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${DB}${suffix}`);
    } catch {
      // 不存在就算了
    }
  }
}

async function main(): Promise<void> {
  console.log("1. 收到消息 → 落盘 → 召回 → 回复");
  cleanDb();
  const captured: string[] = [];
  const cfg: BotConfig = {
    ...DEFAULT_BOT_CONFIG,
    memoryDb: DB,
    allowPrivate: [10001],
    allowGroups: [],
    selfId: 99999,
    useLlmExtractor: false, // 测试不依赖模型
  };
  const service = new BotService(cfg, { replyAdapter: fakeAdapter("嗯，我知道。", captured) });

  const reply = await service.handle({
    sessionId: "private:10001",
    userId: 10001,
    userName: "小林",
    text: "王建国说下周三之前把借我的两千块钱还上。",
    isGroup: false,
    selfId: 99999,
  });
  check("回了话", reply === "嗯，我知道。", `实际：${reply}`);
  check("提示词里带了【记忆】段", captured[0]?.includes("【记忆】") ?? false);
  check("提示词里带了对方称呼", captured[0]?.includes("小林") ?? false);
  // 一问一答都落盘：user 的那句 + 她自己回的那句（service.handle 的第 5 步）
  check("原始对话已落盘", pendingTurns(service["db"]) === 2, `待整理 ${pendingTurns(service["db"])} 条`);

  console.log("");
  console.log("2. 陌生人不回 / 自己发的不回");
  const before = service.stats().ignored;
  const stranger = await service.handle({
    sessionId: "private:20002",
    userId: 20002,
    userName: "陌生人",
    text: "你好",
    isGroup: false,
    selfId: 99999,
  });
  check("陌生人被忽略", stranger === null);
  const selfMsg = await service.handle({
    sessionId: "private:99999",
    userId: 99999,
    userName: "自己",
    text: "我自己发的",
    isGroup: false,
    selfId: 99999,
  });
  check("自己发的被忽略", selfMsg === null);
  check("忽略计数增加", service.stats().ignored === before + 2);

  console.log("");
  console.log("3. 睡觉：把待整理的对话变成记忆");
  const sleepStats = await service.sleepNow();
  check("睡眠跑完了", sleepStats !== null);
  check("待整理清零", pendingTurns(service["db"]) === 0, `还有 ${pendingTurns(service["db"])} 条`);
  check("生成了记忆", (sleepStats?.eventsExtracted ?? 0) > 0, `抽到 ${sleepStats?.eventsExtracted ?? 0} 条`);
  check("记录了一次睡眠", service.stats().sleeps === 1);
  service.close();

  console.log("");
  console.log("4. OneBot WebSocket 链路（自己起一个假 NapCat）");
  const port = 3199;
  const mock = await startMockOneBot(port);
  const captured2: string[] = [];
  const svc2 = new BotService(
    { ...cfg, onebotWs: `ws://127.0.0.1:${port}` },
    { replyAdapter: fakeAdapter("收到，我记得。", captured2) },
  );
  const client = new OneBotClient({ ...cfg, onebotWs: `ws://127.0.0.1:${port}` }, (evt) => {
    void (async () => {
      const r = await svc2.handle(evt);
      if (r) client.reply(evt, r);
    })();
  });
  client.connect();

  await new Promise((r) => setTimeout(r, 600));
  check("WebSocket 已握手", mock.server.listening);

  // 扮演 NapCat 推一条私聊消息
  const event = {
    post_type: "message",
    message_type: "private",
    sub_type: "friend",
    message_id: 1,
    user_id: 10001,
    self_id: 99999,
    raw_message: "在吗",
    message: [{ type: "text", data: { text: "在吗" } }],
    sender: { user_id: 10001, nickname: "小林" },
  };
  mock.push(event);

  await new Promise((r) => setTimeout(r, 1500));
  const action = mock.received
    .map((t) => {
      try {
        return JSON.parse(t) as { action?: string; params?: { message?: string } };
      } catch {
        return {};
      }
    })
    .find((a) => a.action === "send_private_msg");
  check("机器人发出了 send_private_msg", Boolean(action), `收到 ${mock.received.length} 帧`);
  check("回复内容是模型给的", action?.params?.message === "收到，我记得。", `实际：${action?.params?.message}`);

  client.close();
  svc2.close();
  mock.close();

  console.log("");
  if (failed > 0) {
    console.log(`✗ ${failed} 项失败`);
    process.exitCode = 1;
  } else {
    console.log("✓ 全部通过");
  }
}

await main();

