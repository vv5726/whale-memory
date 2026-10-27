import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-logs-${ts}`);
mkdirSync(dir, { recursive: true });
for (const f of ["src/bot/service.ts", "src/tools/index.ts", "src/bot/autonomy.ts", "src/bot.ts"]) {
  try {
    copyFileSync(f, join(dir, f.replace(/[\\/]/g, "_")));
  } catch {
    /* 跳过 */
  }
}
console.log(`① 备份 → ${dir}`);

// 乱码日志文案 → 重写成正常中文（只动 console.* 那一行的字符串）
const fixes: Array<[string, RegExp, string]> = [
  ["src/bot/service.ts", /console\.warn\("\[bot\] [^"]*笔记[^"]*"/, 'console.warn("[bot] 记笔记失败:"'],
  ["src/bot/service.ts", /console\.error\("\[bot\] [^"]*对话失败[^"]*"/, 'console.error("[bot] 记录对话失败:"'],
  ["src/bot/service.ts", /console\.error\("\[bot\] [^"]*失败[^"]*", err\);\s*$/m, 'console.error("[bot] 召回失败:", err);'],
  ["src/bot/service.ts", /console\.error\("\[bot\] [^"]*回复失败[^"]*"/, 'console.error("[bot] 生成回复失败:"'],
  ["src/bot/service.ts", /console\.warn\("\[bot\] [^"]*图失败[^"]*"/, 'console.warn("[bot] 发图失败:"'],
  ["src/bot/service.ts", /console\.log\(`\[[^\]]*\] \$\{evt\.userName\}/, "console.log(`[消息] ${evt.userName}"],
  ["src/bot/service.ts", /console\.log\(`\[[^\]]*\] \$\{reply\.slice/, "console.log(`[回复] ${reply.slice"],
  ["src/tools/index.ts", /console\.log\("\[tools\] \?[^"]*"/, 'console.log("[tools] 手机连上了，手机工具已挂上"'],
];

for (const [file, re, to] of fixes) {
  let s: string;
  try {
    s = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!re.test(s)) {
    console.log(`  ⚠ ${file} 未匹配：${re.source.slice(0, 30)}`);
    continue;
  }
  s = s.replace(re, to);
  writeFileSync(file, s, "utf8");
  console.log(`  ✓ ${file}：${to.slice(0, 40)}`);
}

// 剩下的乱码日志统一清掉（保留行为，只是不再打印乱码）
for (const file of ["src/bot/service.ts", "src/bot/autonomy.ts", "src/bot.ts"]) {
  let s: string;
  try {
    s = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = s.split("\n");
  let n = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]!;
    if (!/console\.(log|warn|error)/.test(l)) continue;
    if (!l.includes("\uFFFD")) continue;
    // 把乱码区间替换成「（日志）」，保住 console 调用本身
    lines[i] = l.replace(/"[^"]*\uFFFD[^"]*"/g, '"[日志]"').replace(/`[^`]*\uFFFD[^`]*`/g, '"（日志）"');
    n += 1;
  }
  if (n > 0) {
    writeFileSync(file, lines.join("\n"), "utf8");
    console.log(`  ${file}：清了 ${n} 处乱码日志`);
  }
}
