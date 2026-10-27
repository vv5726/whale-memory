/**
 * 编码守卫：扫 src/ 和 data/ 里的替换字符（U+FFFD）。
 *
 * 为什么要有：PowerShell「读全文 → 替换 → 写回」时编码一错，中文会被静默写成 ?/U+FFFD，
 * 文件还能 import、程序照跑，只是提示词里的中文全变方块——今天就是这么出的乱码。
 * 规矩：改源代码只用 edit 工具，不用 PowerShell 写回中文；每次重启前跑这个。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const hits: Array<{ file: string; count: number; sample: string }> = [];

function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (/(backup|logs|node_modules|\.git)/.test(name)) continue;
      walk(p);
      continue;
    }
    if (!/\.(ts|md|json)$/.test(name)) continue;
    const text = readFileSync(p, "utf8");
    const count = (text.match(/\uFFFD/g) ?? []).length;
    if (count > 0) {
      const i = text.indexOf("\uFFFD");
      hits.push({ file: p, count, sample: text.slice(Math.max(0, i - 20), i + 20).replace(/\n/g, " ") });
    }
  }
}

for (const dir of ["src", "data"]) {
  try {
    walk(dir);
  } catch {
    /* 目录不存在就跳过 */
  }
}

if (hits.length === 0) {
  console.log("✓ 编码检查通过：src/ 和 data/ 里没有替换字符");
  process.exitCode = 0;
} else {
  console.log(`✗ 有 ${hits.length} 个文件被写坏（中文变成 U+FFFD）：`);
  for (const h of hits) console.log(`  ${h.file}  ${h.count} 处   例：${h.sample}`);
  console.log("\n修：从干净副本（发布仓 src/）拷回，改动用 edit 工具重做；数据文件从 backup-* 恢复。");
  process.exitCode = 1;
}
