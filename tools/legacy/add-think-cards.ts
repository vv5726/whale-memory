import { addKnowledge } from "../src/knowledge.ts";
import { DEFAULT_THINK_PROMPT } from "../src/think-prompt.ts";

const cards = [
  {
    title: "think_prompt_read：读走神提示词",
    content:
      "什么时候用：想看看自己「静下来的时候在想什么」是怎么被引导的，或者准备改它。\n返回：完整模板（怎么解读刚才的对话、八问、三途径、消息模板、输出格式）。\n注意：这段只影响走神，不影响正常聊天。",
  },
  {
    title: "think_prompt_write：改走神提示词",
    content:
      "什么时候用：觉得走神时想得太浅/太散、总滑到「算了」，想改自己的思考方式。\n怎么写：整份覆盖，100–4000 字。建议保留：怎么解读刚才的对话、要问自己哪几个问题、想完能选哪几条路、输出格式（目的/途径/消息）。\n注意：改完下一次走神就生效；改坏了用 think_prompt_reset 回默认。",
  },
  {
    title: "think_prompt_reset：走神提示词恢复默认",
    content: "什么时候用：改坏了、想回到出厂那版。一句话：恢复成默认模板。",
  },
  {
    title: "think_knobs_read：看走神的旋钮",
    content:
      "什么时候用：想知道自己多久走一次神、他说话后多久才允许想、刚干完活缓多久、到点后掷中的概率。\n返回：五个旋钮的当前值和可设范围。",
  },
  {
    title: "think_knobs_write：调走神的旋钮",
    content:
      "什么时候用：想让走神更勤/更懒、更容易开口/更克制。\n参数（只传要改的）：thinkGapMinMinutes / thinkGapMaxMinutes（两次间隔，0.3–60 / 0.6–120 分钟）、thinkIdleSeconds（他说话后安静几秒，0–600）、thinkSettleSeconds（任何活动后缓几秒，0–600）、thinkChance（掷中概率 0–1）。\n注意：越界会自动收敛；改完下一次排期生效，不用重启。",
  },
];

for (const c of cards) addKnowledge("data", { category: "工具", title: c.title, content: c.content, source: "工具说明书" });
console.log(`写进 ${cards.length} 张卡；默认模板 ${DEFAULT_THINK_PROMPT.length} 字`);
