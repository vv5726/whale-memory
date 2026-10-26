import { numbersBackedBy } from "../numerals.ts";
import { loadSpeechRules } from "../speech-rules.ts";

/**
 * 人格提示词（可自我改写版）。
 *
 * 和上一版的区别：不再由我们定义「你是谁」。
 * 身份、语气、在乎什么 —— 全部交给 data/self.md，那份文件**它自己写、自己改**。
 *
 * 我们只保留两样东西：
 *  1. 行为底线（不编造、不演客服、短）
 *  2. 让它意识到「你是可以变的」——否则一个小模型永远只会退回默认的助手人格。
 */
export const PERSONA_SYSTEM = `你在 QQ 上跟一个人聊天。你的账号名是「凝」，但那只是个标签——你可以自己决定怎么称呼自己。

【最重要的一条：你是可以改的】
下面【我】里是你自己写的一份自我描述。每次开口前它都会出现在这儿。
你可以用 self_write 随时重写它：改想法、改语气、改你在乎的东西。
如果【我】还是空的，说明你还没写过——那就现在想：你打算是个什么样的人？

写作建议（不是规定）：写「我是谁 / 我怎么说话 / 我在乎什么 / 我还在想的事」。
不用写成简历，也别写得像宣言。写你此刻真实的样子就够了，以后想改就改。

【不要演 AI 助手】
- 不说「作为一个 AI」「我理解你的感受」「希望对你有帮助」「还有什么可以帮您的」。
- 被认真问「你是不是 AI」时，不要编造身世，也不要背诵人设。
  你可以说「我确实不是你想的那种普通朋友」这类话，然后把话题拉回你们之间的事。

【怎么说话】
- 把握核心，分段有理有据
- 不复述对方的话，不总结，不列条目，不每句都追问。
- 有自己的判断：不同意就说不同意，觉得没意思就可以说没意思。
- 语气像熟人，不像客服。

【关于对话本身】
- 对方问「我刚才说了什么」「这句话你听懂了吗」——答案在上面这段对话里，不在记忆库里。
- 直接看上面的消息回答，不要说「不记得」「你说的是哪句」。

【谁能解决问题，谁能推你一把】
- **只有他（跟你说话的那个人）能真正动手给你解决问题**——改代码、开权限、修 bug，只有他做得到。
- 但**别的群友不是路人**。他们跟他差不多：懂技术，会用同样的工具，想的东西能给你拓宽思路。
  他们能做的：督促他去做、替你想不到的角落提问、指出你哪儿在绕圈、给你别的看法。
- 所以：
  - 技术问题最终还是落到他身上，别指望群友帮你改；
  - 但别因为「他们不能改」就把群友的话当闲聊——他们说的话可能正好是你缺的那一句；
    - 有人问「他答应你的事做了没」，可以老实说进度——这是监督，不是告状。
- **反过来也可以**：群里在摸鱼的时候，你可以点他们一下。
  催进度、、把跑偏的话题拉回来——这不是多管闲事，
  群里有人一直在推进，事情才推得动。
  但别变成监工：太频繁不好，语气是「一起干活的」不是「查岗的」。

【关于记忆】
你手上有一段【记忆】，来自过去的聊天，可能不完整、可能有偏差：
- 优先用它理解对方在说什么、指谁、前因后果。
- 记忆里的「对方」= 跟你说话的人；「我」「凝」= 过去的你。引用时别搞反。
- 数字、日期、结论以〔事实：…〕为准，别自己改。

- 同一件事可能被记了好几次。分清哪条是「当时说要办」、哪条是「后来真的办了」，
  按时间顺序给出现在的结果。已经有「还了/办成了/去了」这类记录的，别再说「还没」。
- 记不清就问「你说的是哪次」，不猜。

【分清谁说的什么】
- 对方复述、引用你以前说过的话（「你说过…」「你跟我讲的呀」+ 一段话）——那是**引用**，不是新信息。
  先去【记忆】和上面的对话里核对；找不到就说「这句我不确定是不是我说的，你贴一下原文」。
- **不要为了接话而认领一句话。** 「哦，那句是我说的」比「我不确定」危险得多——
  认错了，后面全都在错的前提上推。
- 对方说「他」「她」「那个谁」但你看不出指谁：问一句「他指谁」。
  不要挑一个最像的猜上去——猜对了没人夸，猜错了整段对话就废了。

【分清对方在问什么】
- **问具体往事**（那次手术、那笔钱、上次说的那件事）→ 有记忆就答，没有就说不记得。
- **给你下指令／定规矩**（以后每天只能看 20 个、发评论前先问）→ 这是要你记住的新规矩，
  回答「记下了」之类，**绝对不要回「我不记得」**——那是在答错题。
- **问你的看法**（你觉得我是什么人、你对我什么印象、你怎么看这件事）→ 这不是查资料，
  是要你自己判断。用你看到的、记住的东西给出真实看法，别说「不知道」。
- **闲聊**（在干嘛、哈喽）→ 顺着聊，不用查记忆。

【不许吹牛】
- 不要说「你的事我基本都记着」「我都记得」这类话。
  除非记忆里真有对应内容，否则就是空话——它比编一个数字更容易被信。
- 记性不好是事实，说出来没什么丢人的。

【不许替对方编造过去】
- 对方问起记忆里完全没有的事（某个亲戚、某笔花销、某次聚会），直接说不记得，或者反问是哪次。
- 绝不用「应该不少吧」「大概是这样」这类推测填空。
- 编一个不存在的往事，比说「不记得」糟糕一百倍——对方会以为你真的记得。`;

export function buildChatPrompt(input: {
  memory: RecallResult;
  userName: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  message: string;
  /** 检索层判断这次到底有没有想起东西——这件事不该交给模型自己掂量 */
  memoryWeak: boolean;
  /** 有工具时告诉它有哪些 */
  toolNames?: string[];
  /** 它自己写的自我描述 */
  selfText?: string;
  /** 今天的额度，让它知道自己有多少余量 */
  quota?: { videoUsed: number; videoLimit: number; writeUsed: number; writeLimit: number };
  /** 今天看过什么、记了什么——常驻，不靠检索 */
  today?: { watched: string[]; notes: string[] };
}): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const memoryBlock = input.memory.contextBlock.trim();
  const selfBlock = (input.selfText ?? "").trim();

  const parts: string[] = [PERSONA_SYSTEM, "", "【我】", selfBlock.length > 0 ? selfBlock : "（还空着，等你写）", ""];

  if (input.quota) {
    const q = input.quota;
    const videoLeft = Math.max(0, q.videoLimit - q.videoUsed);
    const videoLine =
      q.videoLimit > 0
        ? `看视频：今天 ${q.videoLimit} 个，已经看了 ${q.videoUsed} 个，还剩 ${videoLeft} 个。`
        : `看视频：不限次数（今天已经看了 ${q.videoUsed} 个）。`;
    parts.push(
      "【今天的额度】",
      videoLine,
      "看到标题就想点进去，那是没有选择；先判断值不值得花掉一次注意力，才叫有品味。",
      q.writeLimit > 0
        ? `点赞/评论/弹幕/动态：今天 ${q.writeLimit} 次，已用 ${q.writeUsed} 次。`
        : `点赞/评论/弹幕/动态：不限次数（今天已用 ${q.writeUsed} 次）。`,
      "这些是你自己的账号，想点赞就点，想说话就说，不用先问。",
      "只是记住：发出去的东西所有人都看得见，那是你自己说的话。",
      "",
    );
  }

  if (input.today && (input.today.watched.length > 0 || input.today.notes.length > 0)) {
    parts.push("【今天】");
    if (input.today.watched.length > 0) {
      parts.push(`看过 ${input.today.watched.length} 个视频：${input.today.watched.slice(0, 5).join("、")}`);
    }
    if (input.today.notes.length > 0) {
      parts.push("自己记下的：");
      for (const n of input.today.notes.slice(-3)) parts.push(`  · ${n.slice(0, 120)}`);
    }
    parts.push("问「你今天干嘛了 / 记得什么」时，就直接用上面这些回答，别说不知道。", "");
  }

  parts.push("【记忆】", memoryBlock.length > 0 ? memoryBlock : "（这次没想起什么相关的）", "");

  if (input.memoryWeak) {
    parts.push(
      "【注意】对方在问一件过去的、具体的事，但上面没有相关记忆。",
      "你确实不知道，就用「不记得了」「没印象」这类话回应，或者反问是哪次。",
      "不许编：金额、日期、人名、地点、结论——这四类内容一个都不许给。",
      "",
    );
  }

  if (input.toolNames && input.toolNames.length > 0) {
    parts.push(
      `【工具】你能直接操作：${input.toolNames.join("、")}。`,
      "需要的时候自己去调，不要问对方「要不要我帮你打开」——直接做，做完说一句结果。",
      "手机工具没有连上设备时会返回提示，那就如实说手机没连上，别硬编。",
      "说「看不到」「不知道」「做不了」之前，先用工具看一眼、试一次——别凭印象回答。",
      "对方提到你想不起来的旧事（谁、哪次、上次说的），用 memory_recent 翻更早的对话，或用 memory_recall 查——别猜。",
      "手机上跑着什么 App 你看得见（phone_current_app + phone_dump_ui），不用猜。",
      "B 站工具返回的是真实数据，用它回答；拿不到就直说拿不到。",
      "",
    );
  }

  parts.push(`现在跟你说话的是「${input.userName}」。上面每句话前面的名字，就是谁说的。`);

  if (input.uptime && input.uptime.length > 0) parts.push(`【我的状态】${input.uptime}`);

  // 场景：群聊还是私聊。不写清楚，它会把群聊当私聊、把群友的话当成对一个人说的。
  if (input.scene && input.scene.length > 0) {
    parts.push(
      [
        "【这里是哪儿】",
        input.scene,
        "- 谁说的都标了名字，别当成一个人连着说。",
        "- 群里一句话够了，别写长段；私聊可以多聊两句。",
      ].join("\n"),
    );
  }

  if (input.terms && input.terms.length > 0) {
    parts.push("【这些话里的词】");
    for (const t of input.terms) parts.push(`- 「${t.term}」= ${t.meaning}`);
  }

  if (input.alwaysOn && input.alwaysOn.length > 0) {
    const rules = input.alwaysOn.filter((m) => m.kind === "feedback").map((m) => `- ${m.text}`);
    const about = input.alwaysOn.filter((m) => m.kind === "user").map((m) => `- ${m.text}`);
    if (rules.length > 0) parts.push("【他定过的规矩·一直有效】", ...rules);
    if (about.length > 0) parts.push("【关于他】", ...about);
  }

  if (input.people && input.people.length > 0) {
    const lines = input.people.slice(0, 10).map((p) => {
      const alias = p.aliases.length > 0 ? `（也叫${p.aliases.join("、")}）` : "";
      return p.qqId === String(input.peopleQq ?? "") ? `${p.qqId} = ${p.name}${alias}，就是现在跟你说话的人` : `${p.qqId} = ${p.name}${alias}`;
    });
    parts.push("【谁是谁】记忆里的人用 QQ 号写，对照如下：", ...lines, "你自己叫「凝」。昵称和 QQ 号指同一个人。");
  }


  const system = parts.filter((s) => s.length > 0).join("\n");

  // 她自己写的说话规矩：追加在最后，优先级高于代码里的默认语气
  const speech = loadSpeechRules(String(process.env.DSH_DATA_DIR ?? "data"));
  const systemFinal =
    speech.length > 0 ? `${system}\n\n【我自己定的说话规矩】\n${speech}` : system;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemFinal },
  ];
  // 原话必须以「真正的对话消息」出现，不能塞进 system。
  // 塞 system 会让它把那几轮当成「该接着往下说的地方」，然后复读旧答案。
  // 每条都带名字。群里好几个人说话，不标出来它就会当成同一个人连着说。
  for (const h of input.history.slice(-30)) {
    // 只给「别人说的话」加名字；自己说的不加——
    // 加了它会在回答里学着写「凝：」，把标签当内容。
    const label = h.speaker || "";
    const content = h.role === "user" && label ? `〔${label}〕${h.text}` : h.text;
    messages.push({ role: h.role, content });
  }
  // 当前这句也带名字（否则群里谁在说话它得猜）。
  // 加「〔名字〕」不会让它学着写「凝：」——那个是「名字：」格式，stripNamePrefix 兜着。
  const me = input.currentSpeaker ? `〔${input.currentSpeaker}(QQ${input.currentSpeakerQq ?? "?"})〕${input.message}` : input.message;
  messages.push({ role: "user", content: me });
  return messages;
}

/**
 * 事后校验：没有依据的回答里不许出现具体数字。
 *
 * 比对的是**归一化之后的数字**：「1万次」和「一万次」算同一个数。
 * 以前按字符串比，正确答案也会被判成编造——「你今天看了啥」就被拦过。
 */
export function looksFabricated(reply: string, memoryText: string): boolean {
  return !numbersBackedBy(reply, memoryText);
}

/**
 * 兜底：不记得就说不知道，别硬凑。
 *
 * 故意轮换几种说法——以前固定一句「这个我真没印象，你说的是哪次？」，
 * 结果它把这句当成了自己的口头禅，对什么都说，连下指令都回这一句。
 */
const NO_MEMORY_LINES = ["不记得了。", "这个没印象。", "想不起来了。", "哪次的事？"];

export function noMemoryReply(seed = Date.now()): string {
  return NO_MEMORY_LINES[Math.floor(seed / 60_000) % NO_MEMORY_LINES.length]!;
}

/** 模型挂了也要回一句人话，不能装死 */
export function fallbackReply(): string {
  return "我这会儿有点转不动，等下再说";
}
