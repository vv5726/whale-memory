import { readFileSync, writeFileSync } from "node:fs";

const p = "src/recall.ts";
let s = readFileSync(p, "utf8");

// ① 打分时乘一个「这条记忆有多完整」的系数
const anchor = "    const raw4 = (evidenceTotal + arousalBonus + recencyBonus) * speakerFactor;";
if (s.includes(anchor) && !s.includes("qualityOf")) {
  s = s.replace(
    anchor,
    [
      "    // 同一条线索下常常有好几版记忆：完整的、半截的、聊这件事的过程。",
      "    // 不区分就会把半截的那条排前面，模型据此判断「其实没有这回事」。",
      "    const raw4 = (evidenceTotal + arousalBonus + recencyBonus) * speakerFactor * qualityOf(e);",
    ].join("\n"),
  );
  console.log("打分已乘上完整度");
}

// ② 追加 qualityOf
if (!s.includes("function qualityOf")) {
  s += `

/**
 * 一条记忆「有多值得被想起来」。
 *
 * 不看相关度——那个已经算过了。这里只看**这条记忆本身干不干净**：
 * 有没有关键事实、正文够不够长、是不是半截话、是不是在聊「这件事本身」。
 */
function qualityOf(e: EventRow): number {
  let q = 1;

  // 有关键事实的明显更值钱（金额、日期、结论都在里面）
  const facts = Array.isArray(e.keyFacts) ? e.keyFacts.length : 0;
  if (facts > 0) q *= 1 + Math.min(0.4, facts * 0.12);

  // 太短的往往是半截话
  const len = String(e.detail ?? "").length;
  if (len < 10) q *= 0.55;
  else if (len < 25) q *= 0.8;

  // 以标点开头、或标题是「X是什么」这种，多半是断句碎片
  const title = String(e.title ?? "").trim();
  if (/^[，。！？；、]/.test(title)) q *= 0.5;
  if (/是什么$|什么意思$/.test(title)) q *= 0.75;

  // 「A；后来B」这种缝起来的，比单一事件弱一档
  if (/；后来/.test(String(e.detail ?? ""))) q *= 0.9;

  return q;
}
`;
  console.log("qualityOf 已加");
}

// ③ 排完序再按「标题近似」去重，同一件事只留最好的一条
const anchor2 = "  const contextBlock = renderContext(factual, affective, coldHints, wokenTexts, mood);";
if (s.includes(anchor2) && !s.includes("dedupeByTitle")) {
  s = s.replace(
    anchor2,
    [
      "  // 同一件事被记了好几版时，只留最好的那条——剩下的重复内容只会挤掉别的记忆。",
      "  const dedupeByTitle = <T extends { event: EventRow }>(list: T[]): T[] => {",
      "    const seen = new Set<string>();",
      "    const out: T[] = [];",
      "    for (const it of list) {",
      "      const key = String(it.event.title ?? \"\")",
      "        .replace(/[，。！？；、\\s]/g, \"\")",
      "        .slice(0, 10);",
      "      if (key.length > 0 && seen.has(key)) continue;",
      "      if (key.length > 0) seen.add(key);",
      "      out.push(it);",
      "    }",
      "    return out;",
      "  };",
      "  const factualDeduped = dedupeByTitle(factual);",
      "",
      "  const contextBlock = renderContext(factualDeduped, affective, coldHints, wokenTexts, mood);",
    ].join("\n"),
  );
  console.log("标题去重已加");
}

writeFileSync(p, s, "utf8");
