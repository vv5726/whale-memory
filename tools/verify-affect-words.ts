// 验收情绪词表：默认 → 叠加文件 → disable 关词，三档对比同一句话的打分
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeAffect, affectWordsSnapshot, initAffectWords } from "../src/affect.ts";

const dir = "data/tmp-affect";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const cases = [
  "小人脸上是无奈苦笑的表情，正在叹气",
  "他母单多年，你就这么把兄弟卖了",
  "嗓子又开始别扭了，说不太出话",
  "今天摸鱼一天，挺放松",
];

function show(title: string): void {
  const snap = affectWordsSnapshot();
  console.log(`\n=== ${title} ===`);
  console.log(`正词 ${Object.keys(snap.positive).length}｜负词 ${Object.keys(snap.negative).length}｜来自文件 ${snap.fromFile.length}｜关掉 ${snap.disabled.join("、") || "无"}`);
  for (const t of cases) {
    const a = analyzeAffect(t);
    console.log(`  「${t.slice(0, 18)}…」 → v=${a.valence} a=${a.arousal} tags=${JSON.stringify(a.tags)}`);
  }
}

// ① 没有文件 = 纯默认
initAffectWords(dir);
show("① 只有默认词典（文件不存在）");

// ② 她写了一份词表：加词 + 关掉「笑」
const file = join(dir, "affect-words.json");
writeFileSync(
  file,
  JSON.stringify(
    {
      negative: {
        苦笑: { v: -0.3, a: 0.35, tag: "无奈" },
        母单: { v: -0.35, a: 0.4, tag: "被戳到" },
        别扭: { v: -0.4, a: 0.4, tag: "别扭" },
      },
      positive: { 摸鱼: { v: 0.35, a: 0.3, tag: "放松" } },
      disable: ["笑"],
      boosters: [{ word: "又开始", add: 0.1 }],
    },
    null,
    2,
  ),
  "utf8",
);
initAffectWords(dir);
show("② 加了她的词、关掉「笑」");

// ③ 文件写坏：应该退回默认，不崩
writeFileSync(file, "{ 这不是 json", "utf8");
initAffectWords(dir);
const broken = analyzeAffect("小人脸上是无奈苦笑的表情，正在叹气");
console.log(`\n=== ③ 文件写坏 ===\n  退回默认词典，没崩：v=${broken.valence} tags=${JSON.stringify(broken.tags)}`);

rmSync(dir, { recursive: true, force: true });
console.log("\n（临时目录已清）");
