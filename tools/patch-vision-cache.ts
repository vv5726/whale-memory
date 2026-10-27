import { readFileSync, writeFileSync } from "node:fs";

const p = "src/vision.ts";
let s = readFileSync(p, "utf8");

if (!s.includes("remembered")) {
  s = s.replace(
    'import { createHash } from "node:crypto";',
    'import { createHash } from "node:crypto";\nimport { remember, remembered } from "./vision-cache.ts";',
  );

  s = s.replace(
    `      const r = await describeImage(file);
      const desc = r.ok ? r.text.replace(/\\s+/g, " ").slice(0, 200) : item.summary || "看不清";
      out = out.replace(item.full, \`[发了张图：\${desc}]\`);`,
    `      // 十分钟内见过同一张图 → 不再描述，也不再占一段对话
      const before = remembered(dataDir, hash);
      if (before) {
        out = out.replace(item.full, "[（又是刚才那张图，不重复看了）]");
        continue;
      }
      const r = await describeImage(file);
      const desc = r.ok ? r.text.replace(/\\s+/g, " ").slice(0, 200) : item.summary || "看不清";
      if (r.ok) remember(dataDir, hash, desc);
      out = out.replace(item.full, \`[发了张图：\${desc}]\`);`,
  );

  writeFileSync(p, s, "utf8");
  console.log("图片去重已接");
} else {
  console.log("已经有了");
}
