import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

/**
 * 把控制台输出同时写进文件，并起一个只看日志的网页。
 *
 * 为什么单独做：机器人是后台跑的，输出全在进程里，
 * 想回看「它刚才为什么这么答」只能翻终端。落成文件 + 网页，随时能翻。
 */
export function setupFileLogging(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "bot.log");

  const origLog = console.log.bind(console);
  const origErr = console.error.bind(console);

  const serialize = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };

  const append = (level: string, args: unknown[]): void => {
    const line = `${new Date().toISOString()} [${level}] ${args.map(serialize).join(" ")}\n`;
    try {
      appendFileSync(path, line, "utf8");
    } catch {
      // 写不进去就算了，不能因为日志挂了影响回消息
    }
  };

  console.log = (...args: unknown[]): void => {
    append("INFO", args);
    origLog(...args);
  };
  console.error = (...args: unknown[]): void => {
    append("ERR", args);
    origErr(...args);
  };

  return path;
}

function tail(path: string, lines: number): string[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const all = text.split(/\r?\n/).filter((l) => l.length > 0);
  return all.slice(-lines);
}

const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>凝 · 日志</title>
<style>
  body{margin:0;background:#111418;color:#d7dde5;font:13px/1.55 ui-monospace,Consolas,monospace}
  header{position:sticky;top:0;background:#171b21;border-bottom:1px solid #262c35;padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  h1{font-size:14px;margin:0;font-weight:600;color:#e8eef6}
  .tag{font-size:11px;padding:2px 7px;border-radius:99px;background:#1f2630;color:#8b98aa}
  input,select,button{background:#1f2630;color:#d7dde5;border:1px solid #2f3742;border-radius:6px;padding:4px 8px;font:inherit}
  button{cursor:pointer}button:hover{background:#28303b}
  main{padding:12px 16px 40px}
  .line{white-space:pre-wrap;word-break:break-all;padding:1px 0}
  .err{color:#ff8c8c}
  .tool{color:#88d0ff}
  .msg{color:#a6e3a1}
  .dim{color:#6b7684}
</style></head>
<body>
<header>
  <h1>凝 · 运行日志</h1>
  <input id="filter" placeholder="过滤（比如 tool / 消息 / 错误）" size="26">
  <label class="tag"><input type="checkbox" id="auto" checked> 自动刷新</label>
  <span class="tag" id="stat">—</span>
  <button id="reload">刷新</button>
</header>
<main id="out"><div class="dim">加载中…</div></main>
<script>
let timer = null;
function cls(t){
  if (t.includes('[ERR]')) return 'err';
  if (t.includes('[tool]')) return 'tool';
  if (t.includes('[消息]') || t.includes('[回复]')) return 'msg';
  return '';
}
async function load(){
  const n = 400;
  const r = await fetch('/api/logs?lines=' + n);
  const data = await r.json();
  const f = document.getElementById('filter').value.trim();
  const out = document.getElementById('out');
  const lines = (data.lines || []).filter(t => !f || t.includes(f));
  document.getElementById('stat').textContent = lines.length + ' / ' + (data.lines||[]).length + ' 行';
  out.innerHTML = lines.map(t => '<div class="line ' + cls(t) + '">' + t.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) + '</div>').join('');
  window.scrollTo(0, document.body.scrollHeight);
}
function schedule(){
  if (timer) clearInterval(timer);
  if (document.getElementById('auto').checked) timer = setInterval(load, 2000);
}
document.getElementById('reload').onclick = load;
document.getElementById('auto').onchange = schedule;
document.getElementById('filter').oninput = load;
load(); schedule();
</script>
</body></html>`;

export function startLogServer(port: number, logPath: string): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/api/logs") {
      const n = Math.min(2000, Math.max(1, Number(url.searchParams.get("lines")) || 200));
      const body = JSON.stringify({ lines: tail(logPath, n) });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(body);
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGE);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    // 端口被占（比如已经有一个机器人在跑）不该让整个进程崩掉
    if (err.code === "EADDRINUSE") {
      console.warn(`[log] 端口 ${port} 已被占用，这次不开日志网页（日志文件照常写）`);
    } else {
      console.warn(`[log] 日志网页启动失败：${err.message}`);
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}
