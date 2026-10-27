import { readFileSync, writeFileSync } from "node:fs";

const p = "src/recall.ts";
let s = readFileSync(p, "utf8");

// ① 更严的完整度：缝合体、长dump、标题过长都要降权
s = s.replace(
  "  // 「A；后来B」这种缝起来的，比单一事件弱一档\n  if (/；后来/.test(String(e.detail ?? \"\"))) q *= 0.9;",
  [
    "  // 「A；后来B」这种缝起来的，是两条不相干的事被压成一条，重罚",
    '  if (/；后来/.test(String(e.detail ?? ""))) q *= 0.55;',
    "",
    "  // 太长的正文多半是把整段对话倒进来了，不是一条事",
    "  if (len > 180) q *= 0.75;",
    "",
    "  // 标题太长也不像一条干净的记忆",
    "  if (title.length > 30) q *= 0.85;",
  ].join("\n"),
);

// ② 标题命中问题关键词的，强力加权——标题才是「这条在讲什么」
s = s.replace(
  "    const raw4 = (evidenceTotal + arousalBonus + recencyBonus) * speakerFactor * qualityOf(e);",
  [
    "    // 标题里出现问题的关键词，说明这条**就是在讲这件事**，比正文顺带提到的强得多",
    "    const titleText = String(e.title ?? \"\");",
    "    const titleHit = queryGrams.some((g) => g.length >= 2 && titleText.includes(g)) ? 1.6 : 1;",
    "",
    "    const raw4 = (evidenceTotal + arousalBonus + recencyBonus) * speakerFactor * qualityOf(e) * titleHit;",
  ].join("\n"),
);

writeFileSync(p, s, "utf8");
console.log("完整度与标题命中已加强");
