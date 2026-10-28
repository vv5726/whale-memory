import type { BotConfig } from "./config.ts";
import type { BotService } from "./service.ts";
import { ReaderAgent } from "./reader.ts";

/**
 * 阅读这条管道：**读 → 简报 → 落条目 → 学**。
 *
 * 以前它散在 autonomy.ts 里，而且是两份（旧 runOnce 一份、新的 readOnce 一份），
 * 改一处忘另一处就会静默不一致。现在收成这一个入口，三种触发者共用：
 *
 *   1. 走神·内容      —— 想起一件事，判断该去看看
 *   2. 队列·heavy    —— 批处理里遇到「得查资料才知道怎么做」的条目
 *   3. （以后）聊天里明确要求「帮我看看这个视频」
 *
 * 铁律：**字幕全文只活在这里**。出去的只有 ≤300 字简报（summary），
 * 学习轮看到的是简报，不是原文。这条以前靠约定，现在靠模块边界。
 */

/** 阅读员和它的学习轮都不许碰手机（和走神同一条规矩） */
const noPhoneTools = (name: string): boolean => !name.startsWith("phone_");

export interface ReadTask {
  /** 为什么去看：走神带来的是「想起XX」，队列带来的是那条待办 */
  why: string;
  /** 重点看什么（可选） */
  focus?: string;
}

export interface ReadResult {
  ok: boolean;
  reason: string;
  /** ≤300 字简报——唯一能出这个模块的东西 */
  summary: string;
  /** 从简报里拆出来的「读到的」条目 */
  items: string[];
  /** 其中几条真进了知识库 */
  learned: number;
  /** 学习轮最后那句话（进手记） */
  said: string;
  videosRead: number;
  toolsUsed: string[];
}

const EMPTY: ReadResult = {
  ok: false,
  reason: "",
  summary: "",
  items: [],
  learned: 0,
  said: "",
  videosRead: 0,
  toolsUsed: [],
};

export class Reading {
  private cfg: BotConfig;
  private service: BotService;
  private reader: ReaderAgent | null;

  constructor(cfg: BotConfig, service: BotService, reader: ReaderAgent | null) {
    this.cfg = cfg;
    this.service = service;
    this.reader = reader;
  }

  hasReader(): boolean {
    return this.reader !== null;
  }

  /** 「我的处境」：我是谁 + 我正在做的事。给阅读员和主对话都用 */
  private situation(): string {
    const lines: string[] = [];
    try {
      const self = (this.service.readSelfText() ?? "").replace(/\s+/g, " ").trim();
      if (self.length > 0) lines.push(`我是谁：${self.slice(0, 240)}`);
    } catch {
      // 读不到 self.md 就算了
    }
    try {
      const loops = this.service.openLoops(3);
      if (loops.length > 0) lines.push(`我正在做的事：${loops.join("；")}`);
    } catch {
      // 查不到待办就算了
    }
    return lines.join("\n");
  }

  /** 「今天看过什么」只给最近几条 */
  private watchedBrief(limit = 8): string {
    return this.service.watchedToday().slice(-limit).join("、");
  }

  /** 派给阅读员的任务：读什么 */
  buildTask(task: ReadTask): string {
    const watched = this.watchedBrief();
    const budget = this.service.autonomyBudget();
    const quotaLine = budget.videoUnlimited
      ? `今天读视频不限次数（已经读了 ${budget.videoUsed} 个）。`
      : `今天还能读 ${budget.videoLeft} 个视频。`;
    return [
      task.why.length > 0 ? `为什么去看：${task.why}` : "",
      task.focus && task.focus.length > 0 ? `重点看：${task.focus}` : "",
      "今天有什么值得看的。翻一翻热门和排行，挑值得的花时间读。",
      this.situation(),
      watched.length > 0 ? `今天已经看过：${watched}。看过的也可以再看，重读一遍往往比看新的收获大。` : "",
      quotaLine,
      "额度你自己分配：想读几个读几个。",
      "如果今天想轻松点：用 bili_search 搜「热梗」「梗合集」「网络热词」，",
      "  把还在流行的梗学下来（category 填「热梗」，source 写 BV 号和日期，content 写清意思+什么场合用+一句例句）。",
      "  过时的不学——记梗是为了聊天时能用，不是攒词条。",
      "但每一条读过的都要写清楚它讲了什么——读了却不记住，等于白花额度。",
      "读不完的记下来，明天接着读。",
    ]
      .filter((s) => s.length > 0)
      .join("\n");
  }

  /**
   * 读完之后的交代：四个问题，然后**真的学进去**（知识库/词库）。
   * 以前只有一句「说一句真实的看法」→ 它只能评价内容，落不到自己身上。
   */
  buildLearnPrompt(summary: string, learned: number): string {
    return [
      "阅读员刚去看了一圈，简报如下：",
      "",
      summary,
      "",
      "——",
      "这是内部简报，别复述给任何人。",
      this.situation(),
      "",
      "按这四个问题想一遍，把它变成你自己的东西：",
      "1. 这跟我的目的有什么关系？",
      "2. 我能学到什么？",
      "3. 这对我是好的吗？（有没有反例、代价，我原来的做法要不要改）",
      "4. 我要怎么做？",
      "",
      learned > 0
        ? `（其中 ${learned} 条已经自动收进知识库了，可以用 kb_search 看看；要补充/改写就用 kb_add。）`
        : "（这次没能自动收进知识库——如果你真学到了什么，用 kb_add 记进去。）",
      "遇到新词、梗、黑话，用 learn 记进词库（说清是谁说的）。",
      "最后用 self_note 记一句：这四问你答了什么、接下来要做什么。",
      "如果这次确实没学到什么，就直说「今天没学到」，不要凑。",
    ]
      .filter((s) => s.length > 0)
      .join("\n");
  }

  /** 跑一轮：阅读员去读 → 条目落盘 → 学习轮把它变成自己的东西 */
  async run(task: ReadTask): Promise<ReadResult> {
    if (!this.reader) return { ...EMPTY, reason: "没有阅读员" };

    const report = await this.reader.read(this.buildTask(task));
    const summary = report.summary.trim();
    if (summary.length === 0) return { ...EMPTY, reason: "阅读员没读出东西" };

    // 读过的必须留下来：先落一条 note（过程），再**必须进知识库**（能用得上）。
    let learned = 0;
    const items = parseReadItems(summary);
    for (const item of items) {
      this.service.recordNote(`读到的：${item}`);
      if (this.service.rememberLearned(item)) learned += 1;
    }

    // 主对话只拿到简报，看不见字幕原文
    const said = await this.service.act(this.buildLearnPrompt(summary, learned), 4, {
      toolFilter: noPhoneTools,
      tag: "learn",
    });

    return {
      ok: true,
      reason: "",
      summary,
      items,
      learned,
      said,
      videosRead: report.videosRead,
      toolsUsed: report.toolsUsed,
    };
  }
}

/**
 * 从阅读员的简报里抽出「读过的条目」。
 *
 * 它可能写成一行一条，也可能写成【读了】小标题 + 多行列表——两种都要认，
 * 否则读过的东西一条都进不了记忆。
 */
export function parseReadItems(summary: string): string[] {
  const items: string[] = [];
  const lines = summary.split(/\r?\n/);
  let inSection = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const header = /^【(.+?)】\s*(.*)$/.exec(line);
    if (header) {
      inSection = header[1]!.includes("读了") || header[1]!.includes("值得");
      const rest = (header[2] ?? "").trim();
      if (inSection && rest.length > 0) items.push(rest);
      continue;
    }

    if (inSection) items.push(line);
  }

  return items.slice(0, 10);
}
