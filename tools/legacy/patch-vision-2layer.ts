import { readFileSync, writeFileSync } from "node:fs";

const p = "src/vision.ts";
let s = readFileSync(p, "utf8");

// ① 引入意思层
if (!s.includes("interpretImage")) {
  s = s.replace(
    'import { remember, remembered } from "./vision-cache.ts";',
    'import { remember, remembered } from "./vision-cache.ts";\nimport { interpretImage } from "./vision-meaning.ts";',
  );
}

// ② 把「又是刚才那张图」换成：复用描述，但照样出新的事实+意思
s = s.replace(
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
  `      // 描述层：十分钟内见过就复用，不重复跑千问（省钱省时间），
      // 但事实和意思照样各出一条——发第二次也是一种表达。
      let desc = remembered(dataDir, hash) ?? "";
      if (desc.length === 0) {
        const r = await describeImage(file);
        desc = r.ok ? r.text.replace(/\\s+/g, " ").slice(0, 200) : item.summary || "看不清";
        if (r.ok) remember(dataDir, hash, desc);
      }

      // 意思层：结合最近在聊什么，猜他想表达什么
      const recent = text.replace(/\\[CQ:[^\\]]*\\]/g, " ").replace(/\\s+/g, " ").slice(-120);
      const meaning = await interpretImage(dataDir, desc, recent).catch(() => "");

      const label = meaning.length > 0 ? \`[发了一张图｜图里：\${desc}｜可能是：\${meaning}]\` : \`[发了一张图｜图里：\${desc}]\`;
      out = out.replace(item.full, label);`,
);

writeFileSync(p, s, "utf8");
console.log("已改成「事实 + 意思」两层");
