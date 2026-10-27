/**
 * 补最后一张卡（memes_recent），并修一处写错的工具名（memory_recall → memory_recent）。
 */
import { addKnowledge, loadKb } from "../src/knowledge.ts";

addKnowledge("data", {
  category: "工具",
  title: "memes_recent：查最近学过的热梗",
  content:
    "什么时候用：聊天里想用个梗，先查一下自己最近学了什么、哪天的、是不是快过气了。\n参数：days 只看最近几天（默认 21 天）；query 按关键词或场景筛（比如「哄人」「自嘲」「阴阳」）。\n注意：超过 14 天的会标「快过气了」，两周以上最好别用；想学新梗用 bili_search 搜「热梗」「梗合集」，学到后 kb_add（category 填「热梗」，source 写 BV 号和日期）。",
  source: "工具说明书",
});

// 之前把 memory_recent 写成了 memory_recall；同标题 upsert 即可改正
addKnowledge("data", {
  category: "工具",
  title: "memory_list：我记住什么了",
  content:
    "什么时候用：想知道「我一共记了什么」「昨天记了哪些」，或找一条记不清标题的记忆。\n参数：limit（默认 20）、kind（user/feedback/project/reference/event）、sinceDays。\n注意：它只给标题和 id，正文要用 memory_recent（按词搜）或 memory_day（按天翻）。",
  source: "工具说明书",
});

const cards = loadKb("data").entries.filter((e) => e.category === "工具");
console.log(`工具卡现在 ${cards.length} 张`);
console.log(`memes_recent 卡在吗: ${cards.some((c) => c.title.includes("memes_recent"))}`);
console.log(`还写着 memory_recall 吗: ${cards.some((c) => c.content.includes("memory_recall"))}`);
