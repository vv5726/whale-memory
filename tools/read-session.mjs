import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const root = join(homedir(), ".dsh", "sessions");

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".zstd")) out.push({ p, t: statSync(p).mtimeMs, size: statSync(p).size });
  }
  return out;
}

const files = walk(root).sort((a, b) => b.t - a.t);
if (files.length === 0) {
  console.log("没有会话文件");
  process.exit(0);
}

const latest = files[0];
console.log(`会话文件：${latest.p}`);
console.log(`大小 ${Math.round(latest.size / 1024)} KB，改于 ${new Date(latest.t).toLocaleTimeString()}\n`);

let text;
try {
  text = zstdDecompressSync(readFileSync(latest.p)).toString("utf8");
} catch (err) {
  console.log("解压失败：", err instanceof Error ? err.message : String(err));
  process.exit(0);
}

const lines = text.split("\n").filter((l) => l.trim().length > 0);
console.log(`共 ${lines.length} 条记录\n`);

const hits = lines.filter((l) => l.includes("小雨"));
console.log(`含「小雨」的记录：${hits.length} 条\n`);

for (const line of hits.slice(-4)) {
  try {
    const j = JSON.parse(line);
    const role = j.role ?? j.message?.role ?? j.type ?? "?";
    let body = j.content ?? j.message?.content ?? j.text ?? "";
    if (Array.isArray(body)) body = body.map((p) => p?.text ?? "").join(" ");
    console.log(`--- ${role} ---`);
    console.log(String(body).slice(0, 900));
    console.log();
  } catch {
    console.log(line.slice(0, 300));
  }
}
