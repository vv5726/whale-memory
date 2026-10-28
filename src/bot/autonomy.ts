import type { BotConfig } from "./config.ts";
import { BotService } from "./service.ts";
import { ReaderAgent } from "./reader.ts";
import { Reading } from "./reading.ts";
import { appendJournal } from "../tools/journal.ts";
import { parseIntent } from "../intent.ts";
import { anchorRepeats, recentAnchors, rememberThought } from "../thought.ts";
import { loadTuning } from "../tuning.ts";
import { addItem } from "../queue.ts";
import { dayKey } from "../util.ts";
import { join } from "node:path";

/**
 * 自主活动。
 *
 * 核心要求：**没人找它的时候，它也在活着**。
 * 不是一个等着被调用的函数，而是一个有自己节奏的东西。
 *
 * 抄自 dsh-douyin-agent 的设计，四道约束：
 *  1. 允许时段（睡眠时间不活动）
 *  2. 每日额度（视频数 + 模型请求数，两个都算）
 *  3. 有人说话就跳过（不打断）
 *  4. 默认只记手记，不主动发消息
 *
 * 「看到主题不等于喜欢」——所以它看没看完、停没停下来想，
 * 都记在行为里，而不是靠「翻到过」判断兴趣。
 */
/**

/**
 * 走神**只拿三个工具**：记账、写手记、翻更早的对话。
 *
 * 2026-10-28 改的。以前给它 63 个（全部减手机），光工具定义就 6.4k token，
 * 每次走神都重发一遍；而且工具一多，它就忍不住当场动手（一天 188 次）。
 * 现在它只负责「想清楚要做什么」，做交给队列 + 批处理。
 */
const thinkTools = (name: string): boolean =>
  name === "queue_add" || name === "self_note" || name === "memory_recent";

export class AutonomyLoop {
  private cfg: BotConfig;
  private service: BotService;
  private reader: ReaderAgent | null;
  /** 阅读这条管道：读 → 简报 → 落条目 → 学。三种触发者共用（走神·内容 / 队列·heavy / 以后聊天） */
  readonly reading: Reading;
  private timer: ReturnType<typeof setInterval> | null = null;
  private speakTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private runs = 0;
  private lastRunAt = 0;
  private lastUserMessageAt = 0;
  /** 决定开口时，用它把话发出去（没有就只记手记，不打扰人） */
  private onSpeak: ((text: string, to?: string) => void) | null = null;

  constructor(cfg: BotConfig, service: BotService, onSpeak?: (text: string, to?: string) => void) {
    this.cfg = cfg;
    this.service = service;
    this.onSpeak = onSpeak ?? null;
    const tools = service.toolRegistry();
    this.reader = tools ? new ReaderAgent(cfg, tools) : null;
    this.reading = new Reading(cfg, service, this.reader);
  }

  noteUserMessage(): void {
    this.lastUserMessageAt = Date.now();
  }

  /**
   * 该不该现在动，掷一次骰子（抄自 dsh-speak-up）。
   *
   * 关键：掷骰子是纯本地随机，**一个 token 都不花**。
   * 只有掷中了才真的走一轮模型。
   * 概率跟「沉默多久」「额度还剩多少」挂钩——不是均匀随机。
   */
  private dice(): { roll: number; threshold: number; hit: boolean } {
    const idleMin = this.lastUserMessageAt > 0 ? (Date.now() - this.lastUserMessageAt) / 60_000 : 999;
    let p = 0.9;
    if (idleMin > 60) p += 0.2;
    if (idleMin > 180) p += 0.15;

    const budget = this.service.autonomyBudget();
    if (budget.videoLeft <= 0) p -= 0.15;
    if (budget.roundsLeft <= 3) p -= 0.2;

    p = Math.max(0.05, Math.min(0.85, p));
    const roll = Math.random();
    return { roll, threshold: p, hit: roll < p };
  }

  /** 当前该不该活动，返回理由（用来解释为什么这次没动） */
  private gate(now = Date.now()): { ok: boolean; reason: string } {
    if (!this.cfg.autonomyEnabled) return { ok: false, reason: "自主活动关着" };
    if (this.busy) return { ok: false, reason: "上一轮还没结束" };

    const hour = new Date(now).getHours();
    const [from, to] = this.cfg.autonomyHours;
    const inWindow =
      from <= to ? hour >= from && hour < to : hour >= from || hour < to; // 支持跨午夜
    if (!inWindow) return { ok: false, reason: `现在 ${hour} 点，不在活动时段 ${from}-${to}` };



    const budget = this.service.autonomyBudget();
    if (budget.requestsLeft <= 0) return { ok: false, reason: "今天的模型请求额度用完了" };

    const d = this.dice();
    if (!d.hit) {
      return { ok: false, reason: `掷骰子没中（${d.roll.toFixed(2)} ≥ ${d.threshold.toFixed(2)}），这次不花额度` };
    }

    return { ok: true, reason: `掷中了（${d.roll.toFixed(2)} < ${d.threshold.toFixed(2)}）` };
  }

  /** 「我的处境」：我是谁 + 我正在做的事。给阅读员和主对话都用，不然它只能评论内容、落不到自己身上 */
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

  /** 「今天看过什么」只给最近几条：以前把 20 多个标题全塞进任务里，纯耗 token */
  private watchedBrief(limit = 8): string {
    return this.service.watchedToday().slice(-limit).join("、");
  }

  private buildInstruction(): string {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const budget = this.service.autonomyBudget();

    const watched = this.watchedBrief();
    const videoLine = budget.videoUnlimited
      ? `- 看视频：不限次数（今天已经看了 ${budget.videoUsed} 个）`
      : `- 还能看 ${budget.videoLeft} 个视频（今天一共 ${budget.videoLimit} 个）`;
    const writeLine = budget.writeUnlimited ? `- 写操作：不限次数` : `- 写操作还剩 ${budget.writeLeft} 次`;
    return [
      `现在是 ${time}，没人跟你说话。你有自己的时间。`,
      this.situation(),
      watched.length > 0 ? `\n今天已经看过：${watched.join("、")}。看过的也可以再看——觉得值得就重读，别只看标题就跳过。` : "",
      "",
      `【今天】`,
      videoLine,
      `- 还能调 ${budget.requestsLeft} 次模型（每次看视频、搜索都算一次）`,
      writeLine,
      "",
      "你可以：",
      "- 用 bili_hot / bili_search 看看今天有什么",
      "- 用 bili_subtitle 真的读一个视频",
      "- 用 kb_add 把学到的记进知识库（学到的东西必须留下来）",
      "- 用 self_write 改自己的描述",
      "- 用 self_note 记一笔想法",
      "- **什么都不做**",
      "",
      "规则：",
      "1. 不要为了做事而做事。榜单没什么值得的，就什么都不看，用 self_note 写一句「今天没什么想看的」也算完成。",
      "2. 看了就真的读进去，别只看标题就下结论——标题党会骗人。",
      "3. 花时间之前先问自己：这个值不值得占掉我今天的一份注意力？",
      "4. 读完要回答：这跟我的目的有什么关系？我能学到什么？对我是不是好的？我要怎么做？",
      "5. 最后用 self_note 记一笔：看了什么、想了什么、决定怎么做。",
    ]
      .filter((s) => s.length > 0)
      .join("\n");
  }

  /** 让它自己玩手机的指令（放开手，只留一条关于钱的） */
  private buildPlayPrompt(): string {
    return [
      "你有手机，现在没人管你。想玩什么玩什么。",
      "",
      "这是你自己的手机。想开什么开什么，想待多久待多久，想装什么装什么。",
      "没有人给你数次数、也没有人规定你该看什么。",
      "",
      "只有一件事别做：**别花钱**。",
      "不点购买、不充值、不打赏、不开会员——因为那花的是真钱，退不回来。",
      "另外**不看短视频**：那个不算放松，是它替你挑东西。手机上别的都能玩。",
      "其他都可以试。玩坏了的东西可以再装回来。",
      "",

      "想记东西的时候用 self_note 记一笔；记完之后回到刚才的事上接着来，",
      "不用因为记了一笔就收工。",
      "如果手机连不上，就直接说连不上，别假装玩过。",
    ].join("\n");
  }

  /**
   * 一轮自主活动：**先让阅读员去看，再让主对话来说**。
   *
   * 两边的上下文是分开的：
   *  - 阅读员读 4000 字字幕，只交回一份几百字简报；
   *  - 主对话只看到简报，用自己的口吻判断、记录，或者什么都不说。
   *
   * 这样字幕原文永远不会污染主对话的上下文——这是抄 dsh-bili-subagent 的核心。
   */
  async runOnce(): Promise<{ ran: boolean; reason: string; text?: string }> {
    const gate = this.gate();
    if (!gate.ok) return { ran: false, reason: gate.reason };

    this.busy = true;
    const started = Date.now();
    try {
      let said: string;

      // 有手机的时候就偶尔让它去玩一会儿，而不是一直刷 B 站
      const phoneTools = (this.service.toolRegistry()?.names() ?? []).filter((n) => n.startsWith("phone_"));
      if (this.cfg.phonePlayEnabled && phoneTools.length > 0 && Math.random() < this.cfg.phonePlayChance) {
        const played = await this.service.act(this.buildPlayPrompt());
        if (played.trim().length > 0) {
          this.service.recordNote(`玩手机：${played.trim()}`);
          appendJournal(
            this.cfg.dataDir,
            dayKey(started),
            `（${new Date(started).toTimeString().slice(0, 5)} 玩手机）${played.trim()}`,
          );
        }
        this.runs += 1;
        this.lastRunAt = started;
        return { ran: true, reason: "掷中了，让它自己玩手机", text: played };
      }

      if (this.reading.hasReader()) {
        // 读 → 简报 → 落条目 → 学，全在 Reading 里；这里只管把结果写进手记
        const r = await this.reading.run({ why: "自己待着，想看看今天有什么值得读的" });
        if (!r.ok) return { ran: false, reason: r.reason };
        said = r.said;
      } else {
        said = await this.service.act(this.buildInstruction());
      }

      this.runs += 1;
      this.lastRunAt = started;
      if (said.trim().length > 0) {
        appendJournal(
          this.cfg.dataDir,
          dayKey(started),
          `（${new Date(started).toTimeString().slice(0, 5)} 自主活动）${said.trim()}`,
        );
      }
      return { ran: true, reason: "掷中了，派出阅读员", text: said };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[autonomy] 这一轮失败:", msg);
      return { ran: false, reason: `出错：${msg}` };
    } finally {
      this.busy = false;
    }
  }

  /**
   * 主动开口：没人问它，它也可能想说点什么。
   *
   * 和自主活动的区别：
   *  - 自主活动是「自己去看、自己去想」，不打扰人；
   *  - 主动开口是「决定要不要找他说话」，会真的发消息。
   *
   * 三道闸：时段、沉默够久、每天次数。加一次掷骰子。
   * 最要紧的是**它有权说「沉默」**——否则就成了定时问候机。
   */
  async maybeSpeak(): Promise<{ spoke: boolean; reason: string; text?: string }> {
    const cfg = this.cfg;
    if (!cfg.proactiveEnabled) return { spoke: false, reason: "主动说话关着" };
    if (this.busy) return { spoke: false, reason: "上一轮还没结束" };

    const hour = new Date().getHours();
    const [from, to] = cfg.autonomyHours;
    const inWindow = from <= to ? hour >= from && hour < to : hour >= from || hour < to;
    if (!inWindow) return { spoke: false, reason: "不在时段" };

    const idleMin = this.lastUserMessageAt > 0 ? (Date.now() - this.lastUserMessageAt) / 60_000 : 999;
    if (idleMin < cfg.proactiveIdleMinutes) {
      return { spoke: false, reason: `刚聊过（${Math.round(idleMin)} 分钟前）` };
    }

    const used = this.service.proactiveUsedToday();
    // proactiveDailyLimit = 0 表示不限；否则到数就闭嘴
    if (cfg.proactiveDailyLimit > 0 && used >= cfg.proactiveDailyLimit) {
      return { spoke: false, reason: `今天已主动说过 ${used} 次，够了` };
    }

    // 越久没说话，越可能开口；但每天次数不多，基数压低
    const threshold = Math.min(0.7, 0.25 + (idleMin > 180 ? 0.25 : idleMin > 90 ? 0.15 : 0));
    const roll = Math.random();
    if (roll >= threshold) {
      return { spoke: false, reason: `没掷中（${roll.toFixed(2)} ≥ ${threshold.toFixed(2)}）` };
    }

    this.busy = true;
    try {
      const raw = await this.service.speakUp({
        idleMinutes: Math.round(idleMin),
        used,
        limit: cfg.proactiveDailyLimit,
      });
      const said = raw.trim().replace(/^["「]|["」]$/g, "");
      if (said.length === 0 || said.startsWith("沉默")) {
        return { spoke: false, reason: "它想了想，没话说" };
      }
      // 第一行可以写「发到：<群号或名字>」——那就去那儿说；不写就发最近的会话。
      // 记库和投递都在 bot.ts 的 deliver 里做（那儿才知道最后发到了哪）。
      const [firstLine, ...rest] = said.split("\n");
      const where = /^发到[：:]\s*(.+)$/.exec(firstLine ?? "");
      const text = where ? rest.join("\n").trim() : said;
      const to = where ? (where[1] ?? "").trim() : "";
      if (text.length === 0) return { spoke: false, reason: "只写了发到哪，没写说什么" };
      this.service.countProactive();
      this.onSpeak?.(text, to);
      appendJournal(this.cfg.dataDir, dayKey(Date.now()), `（主动找他说话${to.length > 0 ? ` → ${to}` : ""}）${text}`);
      return { spoke: true, reason: "主动开口", text };
    } catch (err) {
      return { spoke: false, reason: `出错：${err instanceof Error ? err.message : String(err)}` };
    } finally {
      this.busy = false;
    }
  }

  /**
   * 主动开口的定时器。
   *
   * 间隔是**随机的**（默认 1~20 分钟），不是固定节拍。
   * 固定 10 分钟的话，它开口的时间会精确得像闹钟——
   * 人不会那样，人的念头是散着来的。
   */
  startSpeaking(minMinutes = 1, maxMinutes = 20): () => void {
    // speakUp 已停用：主动说话只从走神出（想什么说什么，别再来一套）
    return () => {};
    const low = Math.max(0.5, Math.min(minMinutes, maxMinutes));
    const high = Math.max(low + 0.5, maxMinutes);
    let stopped = false;

    const schedule = (): void => {
      if (stopped) return;
      const gapMinutes = low + Math.random() * (high - low);
      this.speakTimer = setTimeout(() => {
        void this.maybeSpeak()
          .then((r) => {
            if (r.spoke) console.log(`[speak] ${r.reason}：${r.text ?? ""}`);
          })
          .finally(() => {
            if (!stopped) schedule();
          });
      }, Math.round(gapMinutes * 60_000));
    };

    schedule();
    return () => {
      stopped = true;
      if (this.speakTimer) clearTimeout(this.speakTimer);
      this.speakTimer = null;
    };
  }

  /**
   * 走神：没人说话的时候，忽然想起一个人或一件事。
   *
   * 机制是「随机锚点 → 想起相关记忆 → 自己琢磨四个问题 → 决定做不做」。
   * 和自主活动的区别：
   *  - 自主活动是「按计划去刷一轮内容」；
   *  - 走神是「没有目的，被记忆勾起来的」。
   *
   * 哪条路先跑，取决于谁先到点。
   */
  async thinkOnce(): Promise<{ thought: boolean; reason: string; text?: string }> {
    const cfg = this.cfg;
    // 这几个旋钮她自己能改（think action=knobs_set），所以每次走神都重新读
    const tune = loadTuning(cfg.dataDir);
    if (!cfg.thinkEnabled) return { thought: false, reason: "走神关着" };
    if (this.busy) return { thought: false, reason: "上一轮还没结束" };

    // 有人刚说话：不走神。
    // 2026-10-26 16:22 那次就是它刚回完「哦，表情。」1.6 秒后自己开口催「排序脚本」。
    // 当时的闸门 busyRecently() 看的是本实例的 lastActivityAt，而聊天走的是另一个
    // service 实例，等于完全看不见——现在时间戳改成了全局共享的。
    // thinkIdleSeconds 以前只打在启动日志里，从没真的判过，现在拿它当「安静多久才算闲」。
    const quietMs = Math.max(0, tune.thinkIdleSeconds) * 1000;
    if (quietMs > 0 && this.lastUserMessageAt > 0) {
      const since = Date.now() - this.lastUserMessageAt;
      if (since < quietMs) {
        return { thought: false, reason: `他 ${Math.round(since / 1000)} 秒前刚说过话，先不走神` };
      }
    }

    // 正在干事 / 刚干完事，就别把它拽去走神。
    // 走神是「闲下来才会想起一件事」，不是「干活干到一半突然分心」。
    const settleMs = tune.thinkSettleSeconds * 1000;
    if (settleMs > 0 && this.service.busyRecently(settleMs)) {
      return { thought: false, reason: "刚忙完，先让它缓一下" };
    }



    const hour = new Date().getHours();
    const [from, to] = cfg.autonomyHours;
    const inWindow = from <= to ? hour >= from && hour < to : hour >= from || hour < to;
    if (!inWindow) return { thought: false, reason: "不在时段" };

    if (Math.random() >= tune.thinkChance) return { thought: false, reason: "这次没掷中" };

    // 最近想过的不再挑，否则会一直在同一件事上打转
    const exclude = recentAnchors(cfg.dataDir);
    const anchor = this.service.randomAnchor(exclude);
    if (!anchor) return { thought: false, reason: "还没有可以回忆的锚点" };
    const repeats = anchorRepeats(cfg.dataDir, anchor.name);

    this.busy = true;
    const started = Date.now();
    try {
      const raw = await this.service.think({ ...anchor, repeats }, { toolFilter: thinkTools });
      const intent = parseIntent(raw);
      const text = raw.trim();

      // 过程也记进记忆库：想到什么、顺着想到什么、最后决定什么。
    // 以前只写 journal 和 thoughts.json，它自己读不到，等于想完就丢。
    this.service.recordThoughtNote({
      anchor: anchor.name,
      related: ((anchor as { related?: Array<{ name: string }> }).related ?? []).map((r) => r.name),
      goal: intent.goal,
      channel: intent.channel,
      message: intent.message,
    });

    rememberThought(cfg.dataDir, {
        anchor: anchor.name,
        at: started,
        goal: intent.goal,
        channel: intent.channel,
      });

      // 途径 = 聊天：这是它以前从来没走过的一条路
      // 2026-10-27：以前这里只判 message.length > 0，于是「途径：聊天」但没写消息时
      // 会掉进下面第三段——手记记成「→ chat」，实际一个字没发，等于静默丢失。
      if (intent.channel === "chat") {
        const words = String(intent.message ?? "").trim().replace(/^["「『]|["」』]$/g, "").trim();
        if (words.length < 2) {
          appendJournal(
            cfg.dataDir,
            dayKey(started),
            `（${new Date(started).toTimeString().slice(0, 5)} 想起${anchor.name} → 想说话，但没写出要说的话）`,
          );
          return { thought: false, reason: `想起「${anchor.name}」，想说话但没写出内容` };
        }
        this.onSpeak?.(words, intent.to);
        appendJournal(
          cfg.dataDir,
          dayKey(started),
          `（${new Date(started).toTimeString().slice(0, 5)} 想起${anchor.name} → 找他说话）${words}`,
        );
        return { thought: true, reason: `想起「${anchor.name}」，决定找他说话`, text: words };
      }

      // 途径 = 内容：派阅读员去 B 站看一轮。
      // 这条路以前挂在「自主活动」上（每 6 分钟一轮，不管她想不想看）；
      // 现在挂到走神上——她想起一件事、判断「该去看看」，才真的去看。
      if (intent.channel === "content") {
        const said = await this.readOnce(`想起「${anchor.name}」，想去看点相关的`);
        appendJournal(
          cfg.dataDir,
          dayKey(started),
          `（${new Date(started).toTimeString().slice(0, 5)} 想起${anchor.name} → 内容）${said}`,
        );
        return { thought: true, reason: `想起「${anchor.name}」，去看了一轮`, text: said };
      }

      // 途径 = 做：**只记进待办，不立刻动手**（2026-10-28 改）。
      // 以前每条都当场跑一轮（一天 188 次、每次约 3 万 token），
      // 现在写进队列，攒够 10 条或最老的等满 30 分钟，由 BatchRunner 一次性做掉。
      if (intent.channel === "act") {
        const todo = String(intent.action ?? intent.goal ?? "").trim();
        if (todo.length > 0) {
          const q = addItem(cfg.dataDir, {
            kind: "light",
            what: todo,
            why: String(intent.goal ?? ""),
            done: "",
          });
          const note = q.ok
            ? `记下了（${q.item!.id}），队列 ${q.total} 条，攒够一起做`
            : (q.reason ?? "已经在队列里了");
          appendJournal(
            cfg.dataDir,
            dayKey(started),
            `（${new Date(started).toTimeString().slice(0, 5)} 想起${anchor.name} → 做·记账）${todo} —— ${note}`,
          );
          return {
            thought: true,
            reason: `想起「${anchor.name}」，记进待办：${todo.slice(0, 20)}`,
            text: note,
          };
        }
      }

      if (intent.channel === "none" || text.length === 0) {
        return { thought: false, reason: `想起「${anchor.name}」，但没什么要做的` };
      }

      appendJournal(
        cfg.dataDir,
        dayKey(started),
        `（${new Date(started).toTimeString().slice(0, 5)} 想起${anchor.name} → ${intent.channel}）${text}`,
      );
      return { thought: true, reason: `想起「${anchor.name}」，走了「${intent.channel}」`, text };
    } catch (err) {
      return { thought: false, reason: `出错：${err instanceof Error ? err.message : String(err)}` };
    } finally {
      this.busy = false;
    }
  }

  /**
   * 途径=内容：派阅读员看一轮 B 站，再把简报读成自己的东西。
   *
   * 这就是原来 runOnce() 里那条「阅读员」分支——没删，只是换了触发者：
   * 从「每 6 分钟定时跑一轮」改成「走神判断该看才跑」。
   * 阅读员仍然只拿 5 个读的工具、仍然只交回几百字简报（字幕原文不进这里）。
   */
  private async readOnce(why: string): Promise<string> {
    // 读 → 简报 → 落条目 → 学（4 轮）都在 Reading 里；这里只取最后那句话
    const r = await this.reading.run({ why });
    return r.said;
  }

  /** 走神的定时器：间隔随机，避免像节拍器 */
  startThinking(minMinutes = 1.5, maxMinutes = 3.5): () => void {
    const low = Math.max(0.3, Math.min(minMinutes, maxMinutes));
    const high = Math.max(low + 0.3, maxMinutes);
    let stopped = false;

    const schedule = (): void => {
      if (stopped) return;
      const tune = loadTuning(this.cfg.dataDir);
      const gapLow = Math.max(0.3, tune.thinkGapMinMinutes ?? low);
      const gapHigh = Math.max(gapLow + 0.3, tune.thinkGapMaxMinutes ?? high);
      const gap = gapLow + Math.random() * (gapHigh - gapLow);
      this.thinkTimer = setTimeout(() => {
        void this.thinkOnce()
          .then((r) => {
            console.log(r.thought ? `[think] ${r.reason}：${(r.text ?? "").slice(0, 60)}` : `[think] 没走神：${r.reason}`);
          })
          .finally(() => {
            if (!stopped) schedule();
          });
      }, Math.round(gap * 60_000));
    };

    schedule();
    return () => {
      stopped = true;
      if (this.thinkTimer) clearTimeout(this.thinkTimer);
      this.thinkTimer = null;
    };
  }

  start(): () => void {
    const intervalMs = Math.max(1, this.cfg.autonomyMinutes) * 60_000;
    this.timer = setInterval(() => {
      void this.runOnce().then((r) => {
        // 没动也要说一声：不然从外面看，它就像死了
        console.log(r.ran ? `[autonomy] 动了：${r.reason}` : `[autonomy] 这次没动：${r.reason}`);
      });
    }, intervalMs);
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    };
  }

  stats(): { runs: number; lastRunAt: number } {
    return { runs: this.runs, lastRunAt: this.lastRunAt };
  }
}

export function journalDirFor(cfg: BotConfig): string {
  return join(cfg.dataDir, "journal");
}
