/**
 * 编码守卫：扫源码与数据里的两类「静默写坏」。
 *
 * ① 替换字符 U+FFFD（中文被写成问号或那个菱形问号）
 *    成因：PowerShell「读全文 → 替换 → 写回」时编码一错，中文变方块，
 *    文件照样能 import、程序照跑，只是提示词里全是乱码。
 *
 * ② UTF-8 BOM（文件开头三个字节 EF BB BF）
 *    成因：Windows 上的编辑器 / `Set-Content -Encoding utf8` / `Out-File`
 *    默认带 BOM。对我们自己读的文件没事（Node 会吃掉），
 *    但**任何用严格 JSON.parse 读它的程序都会直接崩**——
 *    2026-10-27 就是 `.dsh/profiles/desktop/package.json` 带了 BOM，
 *    把 DSH 整个启动流程炸掉，报的还是一句看不懂的 `Unexpected token ''`。
 *
 * 规矩：改中文只用 edit 工具；写 JSON 一律 UTF-8 无 BOM
 * （`[IO.File]::WriteAllText($p, $s, (New-Object Text.UTF8Encoding($false)))`）；
 * 每次重启前跑这个。
 */
import { readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";

const TEXT_EXT = /\.(ts|mjs|js|json|jsonl|md|yml|yaml|html|css|txt|cmd|ps1)$/;
const SKIP_DIR = /(backup|logs|node_modules|\.git)/;

const bad: Array<{ file: string; count: number; sample: string }> = [];
const bom: string[] = [];

/** 只看开头 3 个字节判断 BOM，不整文件读进来 */
function hasBom(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(3);
    const n = readSync(fd, buf, 0, 3, 0);
    return n === 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  } finally {
    closeSync(fd);
  }
}

function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (SKIP_DIR.test(name)) continue;
      walk(p);
      continue;
    }
    if (!TEXT_EXT.test(name)) continue;

    if (hasBom(p)) bom.push(p);

    const text = readFileSync(p, "utf8");
    const count = (text.match(/\uFFFD/g) ?? []).length;
    if (count > 0) {
      const i = text.indexOf("\uFFFD");
      bad.push({ file: p, count, sample: text.slice(Math.max(0, i - 20), i + 20).replace(/\n/g, " ") });
    }
  }
}

for (const dir of ["src", "tools", "data", "docs", "."]) {
  try {
    walk(dir);
  } catch {
    /* 目录不存在就跳过 */
  }
}

let failed = false;

if (bad.length > 0) {
  failed = true;
  console.log(`✗ 有 ${bad.length} 个文件被写坏（中文变成 U+FFFD）：`);
  for (const h of bad) console.log(`  ${h.file}  ${h.count} 处   例：${h.sample}`);
  console.log("  修：从干净副本（发布仓 src/）拷回，改动用 edit 工具重做；数据文件从 backup-* 恢复。\n");
}

if (bom.length > 0) {
  failed = true;
  // 目录扫描会重复命中同一个文件（"." 递归已经覆盖全部），去重
  const uniq = [...new Set(bom)];
  console.log(`✗ 有 ${uniq.length} 个文件带 UTF-8 BOM（严格 JSON.parse 会直接崩）：`);
  for (const f of uniq) console.log(`  ${f}`);
  console.log(
    "  修：去掉开头 3 个字节即可，内容不动：\n" +
      '    $b = [IO.File]::ReadAllBytes($f); [IO.File]::WriteAllBytes($f, $b[3..($b.Length-1)])\n',
  );
}

if (!failed) {
  console.log("✓ 编码检查通过：没有替换字符，也没有 UTF-8 BOM");
  process.exitCode = 0;
} else {
  process.exitCode = 1;
}
