import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-image-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("src/bot/onebot.ts", join(dir, "src_bot_onebot.ts"));
console.log(`① 备份 → ${dir}`);

const p = "src/bot/onebot.ts";
let s = readFileSync(p, "utf8");

const oldBlock = `    for (const seg of segments) {
      const s = seg as { type?: string; data?: Record<string, unknown> };
      if (s.type === "text") parts.push(String(s.data?.text ?? ""));
    }`;

const newBlock = `    for (const seg of segments) {
      const s = seg as { type?: string; data?: Record<string, unknown> };
      // ★ 以前只收 text，图片段被直接丢掉——那她当然永远只看到占位符。
      if (s.type === "text") {
        parts.push(String(s.data?.text ?? ""));
      } else if (s.type === "image") {
        // 原样拼成 CQ 码，带上 url，后面交给「眼睛」去描述
        const file = String(s.data?.file ?? "");
        const url = String(s.data?.url ?? "");
        const summary = String(s.data?.summary ?? "").replace(/[,\\]]/g, " ");
        parts.push(\`[CQ:image,file=\${file},url=\${encodeURIComponent(url)},summary=\${summary}]\`);
      } else if (s.type === "face") {
        parts.push(\`[CQ:face,id=\${String(s.data?.id ?? "")}]\`);
      } else if (s.type === "at") {
        parts.push(\`[CQ:at,qq=\${String(s.data?.qq ?? "")}]\`);
      } else if (s.type === "record") {
        parts.push("[CQ:record]");
      }
    }`;

if (s.includes(oldBlock)) {
  s = s.replace(oldBlock, newBlock);
  writeFileSync(p, s, "utf8");
  console.log("② 图片/表情/@ 段已保留");
} else {
  console.log("② ✗ 没匹配到 extractText 的循环");
}
