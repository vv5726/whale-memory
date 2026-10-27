import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract.ts";
let s = readFileSync(p, "utf8");

// 1) buildMessages 收说话人名字
s = s.replace(
  "  turns: Array<{ role: string; text: string }>,",
  "  turns: Array<{ role: string; text: string }>,\n  /** 说话人真名：user = 主人，assistant = 她自己 */\n  names: { user: string; assistant: string } = { user: \"主人\", assistant: \"凝\" },",
);

// 2) 渲染时用真名，不用「本人/对方」
s = s.replace(
  '    ...turns.map((t) => `${t.role === "user" ? "本人" : "对方"}：${t.text}`),',
  '    ...turns.map((t) => `${t.role === "user" ? names.user : names.assistant}：${t.text}`),',
);

// 3) 规则：代词必须换成人名
const oldRule = `    "12. **代词必须写清楚，不要照搬对话里的「你」「我」。**",`;
if (s.includes(oldRule)) {
  s = s.replace(
    oldRule,
    `    "12. **代词一律换成真名，不许出现「他」「她」「你」「对方」「本人」。**",
    \`    上面标了每句话是谁说的：${names.user} 和 ${names.assistant}。\`,
    "    对话里说「你」→ 指听话的那一方，写他的名字；说「我」→ 写说话人的名字。",
    "    如果这句话里还有第三个人（群友、某人），把他写进 title 或 detail，别用「他」。",
    "    反例：「群友调侃对方是小雨」（对方是谁？）",
    \`    正例：「群友调侃\${names.user}是小雨」\``,
  );
}

writeFileSync(p, s, "utf8");
console.log("extract：说话人真名 + 代词规则已改");
