import { readFileSync } from "node:fs";

const files = ["src/bot/service.ts", "src/llm/extract.ts", "src/bot/config.ts", "src/bot.ts", "src/tools/index.ts"];

for (const f of files) {
  const s = readFileSync(f, "utf8");
  const lines = s.split("\n");
  let inComment = 0;
  let inString = 0;
  const stringSamples: string[] = [];

  for (const line of lines) {
    if (!line.includes("\uFFFD")) continue;
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) inComment += 1;
    else {
      inString += 1;
      if (stringSamples.length < 3) stringSamples.push(t.slice(0, 60));
    }
  }

  console.log(`\n${f}　${Math.round(Buffer.byteLength(s) / 1024)} KB`);
  console.log(`  乱码行：注释 ${inComment} 行，代码/字符串 ${inString} 行`);
  for (const x of stringSamples) console.log(`    · ${x}`);
}
