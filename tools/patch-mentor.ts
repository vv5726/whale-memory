import { readFileSync, writeFileSync } from "node:fs";

// ① 注册 mentor 工具
{
  const p = "src/tools/index.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("registerMentorTools")) {
    s = s.replace(
      'import { registerKbTools } from "./kb.ts";',
      'import { registerKbTools } from "./kb.ts";\nimport { registerMentorTools } from "./mentor.ts";',
    );
    s = s.replace(
      "  if (memoryHooks) registerKbTools(registry, { add: memoryHooks.kbAdd, search: memoryHooks.kbSearch, list: memoryHooks.kbList });",
      [
        "  if (memoryHooks) registerKbTools(registry, { add: memoryHooks.kbAdd, search: memoryHooks.kbSearch, list: memoryHooks.kbList });",
        "  if (memoryHooks) registerMentorTools(registry, { ask: memoryHooks.mentorAsk, replies: memoryHooks.mentorReplies });",
      ].join("\n"),
    );
    s = s.replace(
      "    kbList?: () => Array<{ category: string; count: number }>;",
      [
        "    kbList?: () => Array<{ category: string; count: number }>;",
        "    mentorAsk?: (question: string, context?: string) => { ok: boolean; text: string };",
        "    mentorReplies?: () => Array<{ answer: string }>;",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("mentor 工具已注册");
  }
}

// ② service 接上
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("mentorAsk")) {
    s = s.replace(
      'import { addKnowledge, listCategories, searchKnowledge } from "../knowledge.ts";',
      'import { addKnowledge, listCategories, searchKnowledge } from "../knowledge.ts";\nimport { askMentor, takeReplies } from "../mentor.ts";',
    );
    s = s.replace(
      "          kbAdd: ({ category, title, content, source }) => {",
      [
        "          mentorAsk: (question, context) => {",
        "            askMentor(this.cfg.dataDir, question, context ?? \"\");",
        "            return { ok: true, text: \"发给顾问了。你先干别的，回复会在之后的对话里出现。\" };",
        "          },",
        "          mentorReplies: () => takeReplies(this.cfg.dataDir).map((r) => ({ answer: r.answer })),",
        "          kbAdd: ({ category, title, content, source }) => {",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("service：mentor 已接");
  }
}

// ③ 提示词：别半夜吵人，技术问题找顾问
{
  const p = "src/bot/persona.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("ask_mentor")) {
    s = s.replace(
      '      "遇到不懂的词（梗、黑话、缩写），用 learn_word 查；查不到就问对方——别装懂，装懂一次后面全错。",',
      [
        '      "遇到不懂的词（梗、黑话、缩写），用 learn_word 查；查不到就问对方——别装懂，装懂一次后面全错。",',
        '      "技术问题（架构怎么改、为什么会这样）用 ask_mentor 问顾问，别半夜把对方吵醒；想问的是「他这个人」才找他。",',
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("persona：顾问提示已加");
  }
}
