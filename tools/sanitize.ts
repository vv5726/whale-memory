import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

// ① 删三份废文件
for (const f of ["src/bot/service.fixed.ts", "src/bot/service.flat.bak", "src/bot/service.recover.ts"]) {
  if (existsSync(f)) {
    rmSync(f);
    console.log(`  删除 ${f}`);
  }
}

// ② 把写死的名字换成通用说法
const patches: Array<[string, string, string]> = [
  [
    "src/bot/persona.ts",
    "- **只有他（vv）能真正动手给你解决问题**——改代码、开权限、修 bug，只有他做得到。",
    "- **只有他（跟你说话的那个人）能真正动手给你解决问题**——改代码、开权限、修 bug，只有他做得到。",
  ],
  [
    "src/sleep.ts",
    'return { user: "vv", assistant: "凝" };',
    'return { user: "对方", assistant: "我" };',
  ],
  [
    "src/scene-anchor.ts",
    '.replace(/^(vv|凝|QQ\\d+|\\d{5,})[：:\\s]*/i, "")',
    '.replace(/^(QQ\\d+|\\d{5,})[：:\\s]*/i, "")',
  ],
  [
    "src/dedup.ts",
    "这个说「vv 要加工具」，那个说「vv 答应加个工具」",
    "这个说「他要加工具」，那个说「他答应加个工具」",
  ],
  [
    "src/merge-dedup.ts",
    "「vv说QQ归凝」和「vv说没调人格参数」会被判成同一件事",
    "「他说账号归谁」和「他说没调参数」会被判成同一件事",
  ],
  [
    "src/learn-person.ts",
    "名字里带这个人（「vv 说的」这种）也算",
    "名字里带这个人（「某某说的」这种）也算",
  ],
];

for (const [file, from, to] of patches) {
  if (!existsSync(file)) continue;
  const s = readFileSync(file, "utf8");
  if (!s.includes(from)) {
    console.log(`  ⚠ ${file} 没找到那句`);
    continue;
  }
  writeFileSync(file, s.replace(from, to), "utf8");
  console.log(`  ✓ ${file} 已脱敏`);
}
