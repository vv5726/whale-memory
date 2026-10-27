/**
 * 补齐 knowledge.json 里缺的 20 张「工具说明书」（category=工具）。
 * 内容按真实 schema 写；她以后可以自己用 kb_add 或 tool_audit 改。
 */
import { addKnowledge, loadKb } from "../src/knowledge.ts";

const cards: Array<{ title: string; content: string }> = [
  {
    title: "extract_rules_add：给抽取规矩追加一条",
    content:
      "什么时候用：发现「这条记忆抽歪了」，想补一条规矩，又不想动现有的。\n怎么写：text 只写一条，比如「带钱的都要写清金额和谁欠谁」。\n注意：它是追加，不是覆盖；要整套重写用 extract_rules_write。",
  },
  {
    title: "extract_rules_write：整套改写抽取规矩（危险）",
    content:
      "什么时候用：现有规矩已经乱到没法一条条补，要重排。\n怎么写：text 是完整的新规矩；不传 confirm 时是**追加**，传 confirm: true 才会整套覆盖、删掉之前所有规矩。\n注意：先 extract_rules_read 看一眼，再决定要不要覆盖。",
  },
  {
    title: "get_time：现在几点、星期几",
    content:
      "什么时候用：对方问「今天几号」「现在几点」「昨天」「最近」「多久了」，或你要排日程。别凭感觉猜日期。\n返回：日期、时间、星期。\n注意：记时间点（比如「周六三点」）之前先调它，算清楚是哪个周六。",
  },
  {
    title: "group_members：群里有谁",
    content:
      "什么时候用：想知道「这个群都有谁」「一共几个人」「群主是谁」。名册包含没开过口的人。\n参数：group 群号（不填用当前群）；onlyAdmins 只看管理；action=sync 现拉一次（有人进退群时）。\n注意：名册是启动时学的，想最新就 sync。",
  },
  {
    title: "group_policy_read：各群我怎么接话",
    content:
      "什么时候用：不确定某个群该不该接话时先看它。\n返回：每个群的 mode（all 每条都接 / mention 只被叫才接）和当时写的理由。",
  },
  {
    title: "group_policy_write：给某个群定接话方式",
    content:
      "什么时候用：某个群太吵，你想只被叫才接；或人少想多聊几句。\n参数：groupId 群号；mode=all 或 mention；note 写一句为什么（以后自己看得懂）。\n注意：人多刷得快用 mention，两三个人就 all；这是你自己的判断。",
  },
  {
    title: "kb_list：知识库有哪些分类",
    content:
      "什么时候用：想知道自己都学了什么、哪个分类攒得多，或找东西前先看目录。\n返回：每个分类多少条。\n注意：想看具体条目用 kb_search（按词搜）。",
  },
  {
    title: "learn_word：遇到不懂的词",
    content:
      "什么时候用：看到梗、黑话、缩写、口头禅不认识，或对方解释了某个词。\n怎么写：term 是词本身；meaning 填意思（不知道就别填，它会告诉你「不认识」，那就去问对方）；saidBy 填谁说的/谁起的（要具体的人）。\n注意：这是词库，不是知识库——一段道理用 kb_add，一个词用 learn_word。",
  },
  {
    title: "memory_forget：真删记忆",
    content:
      "什么时候用：确认某条记忆是错的、重复的、不该留的。\n参数（二选一）：ids 精确删；或 archived_only / older_than_days / title_like 按条件删。\n注意：这是真删除（归档只是打标签、还占检索）；删之前会留一份到 data/forgotten.log，能捞回来。不确定就先归档。",
  },
  {
    title: "memory_list：我记住什么了",
    content:
      "什么时候用：想知道「我一共记了什么」「昨天记了哪些」，或找一条记不清标题的记忆。\n参数：limit（默认 20）、kind（user/feedback/project/reference/event）、sinceDays。\n注意：它只给标题和 id，正文要用 memory_recall 或 memory_day。",
  },
  {
    title: "memory_pin：把一条记忆钉住",
    content:
      "什么时候用：某件事排不上检索的前几名，但你不想让它被压缩下沉（重要的约定、长期项目）。\n参数：title（标题里一段能认出来的）或 id；pin:true 钉 / false 解；expireDays 到期自动解。\n注意：钉太多会让检索变吵，只钉真重要的。",
  },
  {
    title: "memory_settle：给记忆做一次取舍",
    content:
      "什么时候用：某个主题的记忆堆太多、互相重复，想压一压。\n参数：threshold 分数线（默认 6，4-10 之间；越高留得越少）。\n注意：只归档不删除，压错了还能捞回来。",
  },
  {
    title: "memory_stats：我记忆的现状",
    content:
      "什么时候用：想检查自己记了多少、token 占多少、钉了几条、冷存储多少，或者刚整理完看效果。\n返回：各层条数、token 占用、锚点数、钉住条数、冷存储、最近记住了什么。",
  },
  {
    title: "memory_why：为什么是这几条",
    content:
      "什么时候用：检索出来的东西不对味，想知道排序怎么算的（锚点证据、情绪、钉住、强度各多少分）。\n参数：query 用哪句话试（不填用「最近的事」）。\n注意：这是调试用的，别拿它当检索。",
  },
  {
    title: "see_image：看一张图",
    content:
      "什么时候用：对方发图、有截图，你要知道图里是什么。\n参数：path 本地图片路径；question 想特别看什么（不填就自己描述）。\n注意：看图要几秒，别对同一张反复看；本地模型没跑时会失败并告诉你原因。",
  },
  {
    title: "self_journal：读自己的手记",
    content:
      "什么时候用：想回顾「我前几天写了什么」「昨天想了什么」。\n参数：day YYYY-MM-DD（默认今天）。",
  },
  {
    title: "self_note：往手记里写一笔",
    content:
      "什么时候用：没人跟你说话、你自己看完东西/想完事，记一笔真的想法。\n怎么写：text 一两句话，写真的，不写汇报。\n注意：手记是给自己看的，不用写给别人看；也不是记忆（要被记住的事用 memory_save）。",
  },
  {
    title: "speech_rules_add：说话规矩追加一条",
    content:
      "什么时候用：发现某句话不该说、某种场合要收着，补一条规矩。\n怎么写：text 一条，比如「群里不主动提私事」。\n注意：追加，不覆盖；append 到每轮提示词末尾，立刻生效。",
  },
  {
    title: "speech_rules_write：整套改写说话规矩",
    content:
      "什么时候用：说话规矩攒乱了要重排。\n怎么写：text 是完整新规矩（覆盖旧的）；先 speech_rules_read 看一眼再改。\n注意：写的是「怎么说话」（场合、禁忌、口头习惯），不是人格设定（那个用 self_write / persona_write）。",
  },
  {
    title: "tool_audit：工具体检",
    content:
      "什么时候用：想确认自己每个工具是不是都有说明书，或者工具改过名、卡里写了不存在的名字。\n参数：showCovered=true 连已写卡的也列出来。\n补卡：用 kb_add，category 填「工具」，写清什么时候用、怎么写、注意什么。",
  },
];

const existing = loadKb("data").entries.filter((e) => e.category === "工具");
const have = new Set(existing.map((e) => `${e.title}`));
let added = 0;
for (const c of cards) {
  if ([...have].some((t) => t.includes(c.title.split("：")[0]))) {
    console.log(`  跳过（已有卡）：${c.title}`);
    continue;
  }
  addKnowledge("data", { category: "工具", title: c.title, content: c.content, source: "工具说明书" });
  added++;
}
const after = loadKb("data").entries.filter((e) => e.category === "工具");
console.log(`\n新增 ${added} 张；现在工具卡共 ${after.length} 张`);
