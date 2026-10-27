/**
 * OneBot WebSocket 连通性测试：连上 NapCat，问一句「你是谁」。
 *
 * 用法：node tools/ws-test.ts [ws地址] [token]
 */
const url = process.argv[2] ?? "ws://127.0.0.1:3001";
const token = process.argv[3] ?? "whale-2026";

const withToken = new URL(url);
if (token.length > 0) withToken.searchParams.set("access_token", token);

console.log(`连接 ${withToken.toString()}`);
const ws = new WebSocket(withToken.toString());
let done = false;

const timer = setTimeout(() => {
  if (done) return;
  done = true;
  console.error("✗ 超时：15 秒内没有收到响应");
  console.error("  可能是 token 不对（NapCat 会直接断开），或者 3001 没在监听");
  ws.close();
  process.exitCode = 1;
}, 15_000);

ws.addEventListener("open", () => {
  console.log("✓ WebSocket 握手成功");
  ws.send(JSON.stringify({ action: "get_login_info", params: {}, echo: "probe" }));
});

ws.addEventListener("message", (e) => {
  const text = typeof e.data === "string" ? e.data : "";
  let msg: { status?: string; retcode?: number; echo?: unknown; data?: Record<string, unknown> } | null = null;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (msg.echo !== "probe") return;
  done = true;
  clearTimeout(timer);
  if (msg.status === "ok" && msg.retcode === 0) {
    console.log(`✓ 认证通过　机器人 QQ = ${msg.data?.user_id}　昵称 = ${msg.data?.nickname}`);
  } else {
    console.error(`✗ 认证失败：${text.slice(0, 200)}`);
    process.exitCode = 1;
  }
  ws.close();
});

ws.addEventListener("error", (err) => {
  if (done) return;
  done = true;
  console.error(`✗ 连接错误：${(err as ErrorEvent).message ?? err}`);
  process.exitCode = 1;
});

ws.addEventListener("close", () => {
  setTimeout(() => process.exit(process.exitCode ?? 0), 50);
});
