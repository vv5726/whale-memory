import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-nofollow-${ts}`);
mkdirSync(dir, { recursive: true });
for (const f of ["src/bot.ts", "src/bubbles.ts", "src/bot/persona.ts", "data/memory.db"]) {
  try {
    copyFileSync(f, join(dir, f.replace(/[\\/]/g, "_")));
  } catch {
    /* 跳过 */
  }
}
console.log(`① 备份 → ${dir}`);

// ② 关掉回看：轮次直接 0（保留代码，随时能开回来）
{
  const p = "src/bot.ts";
  let s = readFileSync(p, "utf8");
  const before = s;
  s = s.replace(
    /const tries = Math\.random\(\) < turn\.value \? tune\.followUpRounds : 0;/,
    "const tries = 0; // 回看已关闭：一次说完就够，别自己接话",
  );
  if (s === before) {
    console.log("② ✗ 没找到 tries 那行");
  } else {
    writeFileSync(p, s, "utf8");
    console.log("② 回看已关闭（tries = 0）");
  }
}

// ③ 分段改成「按它自己写的换行拆」
{
  const p = "src/bubbles.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("按它自己写的换行拆")) {
    const start = s.indexOf("export function toBubbles");
    const end = s.indexOf("export function bubbleDelay");
    if (start > 0 && end > start) {
      const replacement = `export function toBubbles(text: string): string[] {
  // 按它自己写的换行拆——分几条、在哪儿断，由它决定，不再按句号切
  const clean = String(text ?? "").trim();
  if (clean.length === 0) return [];
  const parts = clean
    .split(/\\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  return parts.length > 0 ? parts : [clean];
}

/** 按它自己写的换行拆（不再按句号） */

`;
      s = s.slice(0, start) + replacement + s.slice(end);
      writeFileSync(p, s, "utf8");
      console.log("③ 分段改成按换行");
    } else {
      console.log("③ ✗ 找不到 toBubbles 的位置");
    }
  } else console.log("③ 已有");
}

// ④ 提示词：告诉它用换行分段
{
  const p = "src/bot/persona.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("换行就是分成几条")) {
    s = s.replace(
      "  - 语气像熟人，不像客服。",
      [
        "  - 语气像熟人，不像客服。",
        "  - **分几条、在哪儿断，你自己定**：想发两条就写两行，想一条说完就别换行。",
        "    换行就是分成几条发出去，别用「\\n\\n」凑空行。",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("④ 提示词已加分段说明");
  } else console.log("④ 已有");
}
