import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-onepath-${ts}`);
mkdirSync(dir, { recursive: true });
for (const f of ["src/bot.ts", "src/bot/autonomy.ts"]) {
  copyFileSync(f, join(dir, f.replace(/[\\/]/g, "_")));
}
console.log(`① 备份 → ${dir}`);

// ② 关掉 speakUp 那条独立路径（走神是唯一出口）
{
  const p = "src/bot/autonomy.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("speakUp 已停用")) {
    s = s.replace(
      "  startSpeaking(minMinutes = 1, maxMinutes = 20): () => void {",
      "  startSpeaking(minMinutes = 1, maxMinutes = 20): () => void {\n    // speakUp 已停用：主动说话只从走神出（想什么说什么，别再来一套）\n    return () => {};",
    );
    writeFileSync(p, s, "utf8");
    console.log("② speakUp 已停用");
  } else console.log("② 已停用");
}

// ③ followUp 彻底停掉（循环变成死代码）
{
  const p = "src/bot.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("followUp 已删除")) {
    const before = s;
    s = s.replace(
      /const tries = 0; \/\/ 回看已关闭[^\n]*/,
      "// followUp 已删除：一次说完就够，不再自己接话。下面这段保留成死代码，方便回滚。\n        const tries = 0;",
    );
    s = s.replace(
      "for (let round = 0; round < tries; round += 1) {",
      "for (let round = 0; false && round < tries; round += 1) {",
    );
    if (s === before) console.log("③ ✗ 没匹配到 followUp 那段");
    else {
      writeFileSync(p, s, "utf8");
      console.log("③ followUp 已停用（循环不会执行）");
    }
  } else console.log("③ 已停用");
}
