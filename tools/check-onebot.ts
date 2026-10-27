/** 直接问 NapCat：现在登录的是谁，能不能发消息 */
import { loadBotConfig } from "../src/bot/config.ts";

const cfg = loadBotConfig();

const ws = new WebSocket(`${cfg.onebotWs}`, {
  headers: { authorization: `Bearer ${cfg.accessToken}` },
} as never);

let id = 0;
const pending = new Map<number, (v: unknown) => void>();

const call = (action: string, params: Record<string, unknown> = {}): Promise<unknown> =>
  new Promise((resolve) => {
    const echo = ++id;
    pending.set(echo, resolve);
    ws.send(JSON.stringify({ action, params, echo }));
    setTimeout(() => resolve({ timeout: true }), 10_000);
  });

ws.addEventListener("message", (ev: MessageEvent) => {
  try {
    const m = JSON.parse(String(ev.data)) as { echo?: number; data?: unknown; status?: string };
    if (m.echo && pending.has(m.echo)) {
      pending.get(m.echo)!(m);
      pending.delete(m.echo);
    }
  } catch {
    // 忽略事件推送
  }
});

ws.addEventListener("open", async () => {
  const info = (await call("get_login_info")) as { data?: { user_id?: number; nickname?: string }; status?: string };
  console.log(`登录信息：${JSON.stringify(info.data ?? info)}`);

  const st = (await call("get_status")) as { data?: { online?: boolean; good?: boolean } };
  console.log(`状态：${JSON.stringify(st.data ?? st)}`);

  const ver = (await call("get_version_info")) as { data?: { app_name?: string; app_version?: string } };
  console.log(`版本：${JSON.stringify(ver.data ?? ver)}`);

  ws.close();
  process.exit(0);
});

ws.addEventListener("error", () => {
  console.log("连接失败");
  process.exit(1);
});

setTimeout(() => {
  console.log("超时");
  process.exit(1);
}, 20_000);
