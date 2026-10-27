import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract.ts";
let s = readFileSync(p, "utf8");

// ① 删掉规则 3（保留原文措辞）——和「换成真名」冲突，且意义不大
const rule3 = `    "3. detail 必须保留原文措辞：可以合并同段相邻句、删语气词，但绝不能概括改写。",
    "   关键事实要原样保留——金额、日期、时间、人名、地点、数量、结论（如「良性」「初试过了」）。",
    "   反例：「他说下周三之前把借我的两千块钱还上」不能精简成「王建国要还钱」。",`;
if (s.includes(rule3)) {
  s = s.replace(rule3, `    "3. detail 写清发生了什么就行，不用逐字照抄；但数字、日期、人名、地点、结论必须准确。",`);
  console.log("规则 3 已放宽");
}

// ② 规则 11 的示例改成 QQ 号
s = s.replace(
  `        → title「小雨 = 群友调侃他早期有点呆」　key_facts ["小雨","糖=不聪明","群友起的绰号"]`,
  `        → title「小雨 = 群友调侃凝早期有点呆」　key_facts ["小雨","糖=不聪明","群友起的绰号"]`,
);

// ③ 重写规则 12：用 QQ 号做身份，凝是自己
const start = s.indexOf('    "12. **代词一律换成真名');
const end = s.indexOf('    "13. **不要记「对话本身」的元叙述。**');
if (start > 0 && end > start) {
  const newRule = `    "12. **人称一律写身份，不许出现「他」「她」「你」「对方」「本人」。**",
    \`    身份用 **QQ 号**：主人是 \${names.user}，你自己叫「凝」。\`,
    "    昵称只是 QQ 号的等价称呼，写进记忆时优先用 QQ 号——昵称会改，号不会。",
    "    对话里说「你」→ 写听话那一方的号；说「我」→ 写说话人自己（主人就写他的号，你就写「凝」）。",
    "    还有第三个人（群友、某人）就写他的号或名字，别用「他」。",
    "    反例：「群友调侃对方是小雨」",
    \`    正例：「\${names.user}调侃凝是小雨」\`,
`;
  s = s.slice(0, start) + newRule + s.slice(end);
  console.log("规则 12 已重写");
}

writeFileSync(p, s, "utf8");
