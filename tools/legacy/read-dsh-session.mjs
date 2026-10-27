import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".dsh", "storages", "session_projcache");
const files = readdirSync(dir)
  .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
  .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);

const latest = files[0];
console.log(`最新会话：${latest.f}`);
const raw = readFileSync(join(dir, latest.f), "utf8");
let data;
try {
  data = JSON.parse(raw);
} catch {
  console.log("解析失败");
  process.exit(0);
}

const msgs =
  data.messages ??
  data.session?.messages ??
  data.history ??
  (Array.isArray(data) ? data : []);
console.log(`消息数：${msgs.length}\n`);

// 找提到小雨的往来
const hits = msgs.filter((m) => JSON.stringify(m).includes("小雨"));
console.log(`提到「小雨」的消息：${hits.length} 条\n`);
for (const m of hits.slice(-6)) {
  const role = m.role ?? m.type ?? "?";
  let text = "";
  if (typeof m.content === "string") text = m.content;
  else if (Array.isArray(m.content)) text = m.content.map((p) => p?.text ?? "").join(" ");
  else text = JSON.stringify(m).slice(0, 300);
  console.log(`--- ${role} ---`);
  console.log(String(text).slice(0, 600));
  console.log();
}
