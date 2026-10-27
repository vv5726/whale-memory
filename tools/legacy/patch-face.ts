import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-face-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("src/cqcode.ts", join(dir, "src_cqcode.ts"));
console.log(`① 备份 → ${dir}`);

const p = "src/cqcode.ts";
let s = readFileSync(p, "utf8");

// ② 表情名未知时不再露号码，优先用 faceText（NapCat 有时会给名字）
const oldFace = `  out = out.replace(/\\[CQ:face,id=(\\d+)[^\\]]*\\]/g, (_m, id: string) => {
    const name = QQ_FACES[id];
    return name ? \`[发了个表情：\${name}]\` : \`[发了个表情（id \${id}）]\`;
  });`;

const newFace = `  out = out.replace(/\\[CQ:face,id=(\\d+)([^\\]]*)\\]/g, (_m, id: string, rest: string) => {
    const name = QQ_FACES[id];
    // NapCat 有时会把表情名放在 faceText 里，优先用它
    const faceText = /faceText=([^,\\]]*)/.exec(rest)?.[1]?.replace(/^\\/+/, "").trim();
    if (name) return \`[发了个表情：\${name}]\`;
    if (faceText) return \`[发了个表情：\${faceText}]\`;
    // 表里没有、也没名字：只说「发了个表情」，不要把 id 甩给它
    return "[发了个表情]";
  });`;

if (s.includes(oldFace)) {
  s = s.replace(oldFace, newFace);
  console.log("② 表情名未知时不再露号码");
} else {
  console.log("② ✗ 没匹配到 face 处理");
}

// ③ 去重：连着两个相同的表情标记，只留一个
if (!s.includes("连着两个同样的表情")) {
  s = s.replace(
    "  // @ 和回复",
    [
      "  // 连着两个同样的表情（NapCat 会同时给 face 段和表情字符）→ 只留一个",
      "  out = out.replace(/(\\[发了个表情[^\\]]*\\])\\s*\\1/g, \"$1\");",
      "",
      "  // @ 和回复",
    ].join("\n"),
  );
  console.log("③ 已加表情去重");
}

writeFileSync(p, s, "utf8");
