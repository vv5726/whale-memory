import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const files: string[] = [];
const walk = (d: string): void => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".ts")) files.push(p);
  }
};
walk("src");

console.log("=== 含 toFixed(4) 的行（金额格式化）===");
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (l.includes("toFixed(4)")) {
      console.log(`  ${f}:${i + 1}\n     ${l.trim().slice(0, 110)}`);
    }
  });
}

console.log("\n=== 乱码行里带数字插值的（很可能是拼给用户看的文案）===");
let n = 0;
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (!l.includes("\uFFFD")) return;
    if (!/\$\{[a-zA-Z_]/.test(l)) return;
    if (n >= 12) return;
    n += 1;
    console.log(`  ${f}:${i + 1}`);
    console.log(`     ${l.trim().slice(0, 110)}`);
  });
}
console.log(`  共 ${n} 处（只列前 12）`);
