import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-banner-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("src/bot.ts", join(dir, "src_bot.ts"));
console.log(`① 备份 → ${dir}`);

// 这几行是启动横幅：内容全是 '?'（GBK 写坏的），按行重写成正常中文
const p = "src/bot.ts";
const lines = readFileSync(p, "utf8").split("\n");

const rewrites: Record<string, string> = {
  "console.log(`???????????": "console.log(`配置文件：",
  'console.log("?? onebotWs / accessToken / allowPrivate / allowGroups': 'console.log("请检查 onebotWs / accessToken / allowPrivate / allowGroups',
};

let changed = 0;
for (let i = 0; i < lines.length; i += 1) {
  const l = lines[i]!;
  const q = (l.match(/\?/g) ?? []).length;
  if (!/console\.(log|warn|error)/.test(l) || q < 3) continue;

  const t = l.trim();
  let next = l;
  if (t.includes("data/bot.json") && t.includes("DeepSeek")) {
    next = "  console.log(`回复后端：DeepSeek　模型 ${cfg.deepseekModel}`);";
  } else if (t.includes("key ?")) {
    next = "  console.log(`  key ${key.slice(0, 6)}***  长度 ${key.length}`);";
  } else if (t.includes("bili_jct")) {
    next = "  console.log(`B站 cookie：bili_jct 长度 ${jct.length}`);";
  } else if (t.includes("SESSDATA")) {
    next = "  console.log(`B站 cookie：SESSDATA 长度 ${cookie.length}`);";
  } else if (t.includes("Ollama")) {
    next = "  console.log(`本地模型：Ollama　${cfg.ollamaModel}`);";
  } else if (t.includes("configPath")) {
    next = "  console.log(`配置文件：${configPath()}`);";
  } else {
    // 其它乱码横幅：保留调用，文案换成人话
    next = l.replace(/"[^"]*\?[^"]*"/g, '"[启动] 提示"').replace(/`[^`]*\?[^`]*`/g, '"启动日志"');
  }
  if (next !== l) {
    lines[i] = next;
    changed += 1;
  }
}

writeFileSync(p, lines.join("\n"), "utf8");
console.log(`② 重写了 ${changed} 行启动横幅`);
