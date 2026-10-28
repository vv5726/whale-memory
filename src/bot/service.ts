import type {
 DatabaseSync } from "node:sqlite";
import { resolveSaidBy } from "../learn-person.ts";
import { initAffectWords } from "../affect.ts";
import type {
 MemoryConfig, RecallResult, SleepStats } from "../types.ts";
import {
 DEFAULT_CONFIG, withOverrides } from "../config.ts";
import {
 openDb, rowToEvent } from "../db.ts";
import {
 ingestTurns } from "../extract.ts";
import {
 pendingTurns, sleepAsync } from "../sleep.ts";
import {
 recall, describeEvent } from "../recall.ts";
import {
 seedFromFile } from "../eval.ts";
import {
 dayKey } from "../util.ts";
import {
 OllamaAdapter, OpenAiCompatibleAdapter, type LlmAdapter } from "../llm/adapter.ts";
import {
 buildChatPrompt, fallbackReply, looksFabricated, noMemoryReply } from "./persona.ts";
import {
 attachPhoneTools, buildTools, detachPhoneTools } from "../tools/index.ts";
import {
 readSelf, ensureSelfSeed } from "../self.ts";
import {
 recordOwnNote, recordThought } from "../notes.ts";
import { ensureSelfPerson, personCardsFor } from "../person-graph.ts";
import { rosterLine, saveGroupMembers, hasRoster } from "../group-roster.ts";
import type { GroupMember } from "./onebot.ts";
import {
 addAlias, ensurePerson, listPeople, resolvePerson } from "../people.ts";
import {
 describeCqCodes } from "../cqcode.ts";
import {
 describeImagesInText } from "../vision.ts";
import { lastChatTarget, noteChatTarget, recentChatTargets } from "./last-chat.ts";
import { duePlans, markReminded, planPromptBlock } from "../plans.ts";
import { thinkPromptBlock } from "../think-prompt.ts";
import { clearPendingImages, setPendingImages } from "./pending-images.ts";
import {
 modeFor } from "../group-policy.ts";
import {
 learnTerm, matchTerms } from "../lexicon.ts";
import {
 addKnowledge, kbForAnchors, linkKnowledge, listCategories, searchKnowledge } from "../knowledge.ts";
import {
 askMentor, takeReplies } from "../mentor.ts";
import {
 settleByScore } from "../settle-score.ts";
import {
 pinMemory } from "../pin.ts";
import {
 aboutPerson } from "../about-person.ts";
import {
 listMemories } from "../list-memories.ts";
import {
 loadTuning, saveTuning } from "../tuning.ts";
import {
 describeUptime, readUptime } from "../uptime.ts";
import {
 canNudge, markNudged } from "../reminders.ts";
import {
 initCost, todayCost } from "../cost.ts";
import {
 resolveApproval, type Approval } from "../approvals.ts";
import {
 quotaUsed, quotaSpend } from "../quota.ts";
import {
 runChatWithTools } from "../llm/toolchat.ts";
import type {
 ToolRegistry } from "../tools/registry.ts";
import type {
 BotConfig } from "./config.ts";
/** 额度用完时 respond() 返回的那一句——它不是她说过的话，不许进历史、手记、记忆 */
const BUDGET_BLOCKED_PREFIX = "今天的额度用完了";
function blockedByBudget(text: string): boolean {
  return String(text ?? "").trimStart().startsWith(BUDGET_BLOCKED_PREFIX);
}

export interface IncomingMessage {
  /** 会话标识：私聊 private:uid，群聊 group:gid:user:uid */


    sessionId: string;
  userId: number;
  userName: string;
  text: string;
  isGroup: boolean;
  groupId?: number;
    mentioned?: boolean;
    selfId: number;
}export interface BotStats {
  received: number;
  replied: number;
  ignored: number;
  failed: number;
  sleeps: number;
  toolCalls: number;
  lastSleepAt: number | null;
  pendingTurns: number;
}const HISTORY_LIMIT = 50;

/**
 * 走神时不给手机工具。
 *
 * 走神是「忽然想起一件事」，不是「拿起手机玩」。以前这两件事混在一处：
 * 她走神走到一半可以自己开 App、点屏幕——一次截图几千字，进了工具循环
 * 还要每轮重发；而且动过手机之后，「想起什么」这件事往往就被屏幕带跑了。
 *
 * 手机工具仍然挂在聊天和自主活动上（那里才是它该出现的场合）。
 */
const noPhoneTools = (name: string): boolean => !name.startsWith("phone_");
/**
 * 取历史时把「当前这一句」剔掉。
 *
 * handle() 会先把当前消息 ingestTurns 写进 turns 表，再拿历史；
 * 冷启动（内存里没历史）时 historyFor 从表里回填 50 条，于是当前这句
 * 既进了 history、又作为 message 传了一次 —— 模型以为对方说了两遍。
 * 表情包最明显：一个表情被读成「两个 524，同一个表情发了两遍」。
 *
 * 只剔最后一条且要一字不差：真正的连续重复（对方真的又发了一句一样的）
 * 是前一条进了历史、后一条当当前消息，剔掉的仍然只有当前这一条。
 */
export function withoutCurrent(
  hist: Array<{ role: "user" | "assistant"; text: string; speaker?: string }>,
  text: string,
): Array<{ role: "user" | "assistant"; text: string; speaker?: string }> {
  const last = hist[hist.length - 1];
  if (last && last.role === "user" && last.text === text) return hist.slice(0, -1);
  return hist;
}

/**
 * 「最近有没有动作」的全局时钟。
 *
 * 为什么不能挂在 service 实例上：聊天走的是 router 里那个 per-user service，
 * 走神用的却是 bot.ts 另建的 autonomyService。两个实例各记各的，
 * 走神那边永远看不到「他刚说完话」——2026-10-26 16:22 它就在回完话 1.6 秒后
 * 自己开口催「排序脚本」。所以这份时间戳必须跨实例共享。
 */
let lastActivityMs = 0;

export function touchActivity(at = Date.now()): void {
  if (at > lastActivityMs) lastActivityMs = at;
}

/** 距离上一次「有动作」多少毫秒；从没动过就是 Infinity */
export function activityAgeMs(): number {
  return lastActivityMs > 0 ? Date.now() - lastActivityMs : Number.POSITIVE_INFINITY;
}

/** 活着的 service 实例（聊天一个、自主活动一个、每个群/人一个） */
const liveServices = new Set<BotService>();

/**
 * 把各实例的对话历史缓存清掉，下次从 turns 表重读。
 *
 * 为什么需要：走神说的话是 `recordSaid` 直接写进 turns 表的，
 * 但聊天用的那个 service 实例把历史缓存在内存里（historyFor 命中缓存就不再读库），
 * 于是它永远看不见「我刚才说过这一句」——你顺着那句回它，它一脸懵。
 * 2026-10-26 16:22 就是这样：它问「排序脚本那边…」，你回「你要什么排序脚本」，
 * 它答「我什么时候要过这个」，因为它自己的那句话不在上下文里。
 */
export function dropHistoryCaches(): void {
  for (const svc of liveServices) svc.forgetHistory();
}
export class BotService {
  private db: DatabaseSync;
  private cfg: BotConfig;
  private memoryCfg: MemoryConfig;
  private replyAdapter: LlmAdapter;
  private extractAdapter?: LlmAdapter;
  private history = new Map<string, Array<{
 role: "user" | "assistant";
 text: string;
 speaker?: string }>>();
  private lastMessageAt = Date.now();
  /** 这个实例最后一次有动作的时间。注意它以前是**没声明**的，
   *  busyRecently 里 Math.max(undefined, …) 会得到 NaN，于是永远返回 false。 */
  private lastActivityAt = 0;
  private lastSleepDay = "";
  private tools: ToolRegistry | null;
  private opts: {
 onImage?: (filePath: string) => void | Promise<void>;
 notify?: (text: string) => void;
 /** 把一句话真的发出去（bot.ts 注入）。返回发到哪了，或者为什么发不出去 */
 deliverText?: (text: string, to?: string) => Promise<{ ok: boolean; text: string }> };
  private sleeping = false;
  /** 群名册拉取器（bot.ts 注入）：只在 group_members 的 action=sync 时用 */
  private rosterSource: ((groupId: number) => Promise<GroupMember[]>) | null = null;  private counters = {
    received: 0,    replied: 0,    ignored: 0,    failed: 0,    sleeps: 0,    toolCalls: 0,    lastSleepAt: null as number | null,  };
  constructor(    cfg: BotConfig,    opts: {
      replyAdapter?: LlmAdapter;
      extractAdapter?: LlmAdapter;
      db?: DatabaseSync;
            onImage?: (filePath: string) => void | Promise<void>;
      sendSticker?: (filePath: string) => void | Promise<void>;
            notify?: (text: string) => void;
      /** 把一句话真的发出去（say_to 工具用）；bot.ts 注入 */
      deliverText?: (text: string, to?: string) => Promise<{ ok: boolean; text: string }>;
    } = {
},  ) {
    this.opts = opts;
    liveServices.add(this);
    // 她自己也是这段人生里的一个人：people 里没有 30001 之前，
    // 她的 12 条发言、6 条自称（speaker_id=凝）都归不到人身上。
    try {
      ensureSelfPerson(this.db, String(this.cfg.selfId ?? ""), "凝");
    } catch {
      // 建不出来不影响回话
    }
    this.cfg = cfg;
    // 情绪词表：默认词典 + 她的 data/affect-words.json（不存在就纯默认）
    try {
      initAffectWords(cfg.dataDir);
    } catch {
      // 读不到词表不影响回话
    }
    this.memoryCfg = withOverrides(DEFAULT_CONFIG, {
      contextBudgetTokens: cfg.contextBudgetTokens,      extractor: cfg.useLlmExtractor ? "llm" : "heuristic",      llmBaseUrl: cfg.ollamaBaseUrl,      llmModel: cfg.ollamaModel,    });
    this.db = opts.db ?? openDb(cfg.memoryDb);

    this.replyAdapter = opts.replyAdapter ?? createChatAdapter(cfg);
    this.tools = cfg.toolsEnabled      ? buildTools(cfg, this.db, opts.notify, {
          sendSticker: (p: string) => this.opts.sendSticker?.(p),
          listFriends: () => this.opts.listFriends?.() ?? Promise.resolve([]),
          deliverText: (t: string, to?: string) => {
            // 没接上就别装能发：以前这里静默返回一句「没连上 OneBot」，
            // 害得她以为连接断了，其实是这个 service 实例没拿到发送器。
            if (!this.opts.deliverText) {
              console.warn("[工具] say_to 没接上发送器（bot.ts/router 没注入 deliverText）");
              return Promise.resolve({ ok: false, text: "这个实例没接上发送器（不是 OneBot 断线）" });
            }
            return this.opts.deliverText(t, to);
          },

          save: (text) => {
            try {
              recordOwnNote(this.db, text, Date.now());
              return {
      ok: true, text: `已记下：${text.slice(0, 30)}` };
            } catch (err) {
              return {
      ok: false, text: `没记上：${err instanceof Error ? err.message : String(err)}` };
            }          },
          db: this.db,          countLive: () => Number(this.db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0),          snapshot: (rows) => {
            try {
              const line = rows.map((r) => JSON.stringify({
 at: Date.now(), id: r.id, title: r.title, detail: r.detail })).join("\n");
              (globalThis as {
 __forgotten?: string[] }).__forgotten?.push(line);
            } catch {

            }          },          getTuning: () => loadTuning(this.cfg.dataDir),          setTuning: (t) => saveTuning(this.cfg.dataDir, t),          pin: (input) => pinMemory(this.db, input),          why: (query) => {
            const r = recall(this.db, this.memoryCfg, query || "最近的事", {
 sessionId: "why" });
            return r.scored ?? [];
          },          about: (input) => aboutPerson(this.db, input),          listMemories: (opts) => listMemories(this.db, opts),          settle: (threshold) => settleByScore(this.db, threshold),          mentorAsk: (question, context) => {
            askMentor(this.cfg.dataDir, question, context ?? "");
            return {
 ok: true, text: "发给顾问了。你先干别的，回复会在之后的对话里出现。" };
          },          mentorReplies: () => takeReplies(this.cfg.dataDir).map((r) => ({
 answer: r.answer })),          kbAdd: ({
 category, title, content, source, anchors }) => {
            const known = (this.db.prepare("SELECT name FROM anchors").all() as Array<{
 name: string }>).map((r) => r.name);
            const e = addKnowledge(this.cfg.dataDir, {
 category, title, content, source, anchors, knownAnchors: known });
            return {
      ok: true, text: `已加入${e.category}：${e.title}` };
          },          kbSearch: (query) => searchKnowledge(this.cfg.dataDir, query).map((e) => ({
 category: e.category, title: e.title, content: e.content, source: e.source })),          kbList: () => listCategories(this.cfg.dataDir),          kbLink: (title, anchor, remove) => linkKnowledge(this.cfg.dataDir, title, anchor, remove),          learn: (term, meaning, saidBy) => { const person = resolveSaidBy(this.db, saidBy); return person ? learnTerm(this.cfg.dataDir, term, meaning, person.name, person) : false; },          lookup: (term) => matchTerms(this.cfg.dataDir, term).find((t) => t.term === term)?.meaning,          tidy: async () => {
            const stats = await this.sleepNow();
            if (!stats) return {
 ok: false, text: "刚刚整理过了，或者没有待整理的东西" };
            const total = Number(this.db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
            return {
      ok: true, text: `整理完了，这次抽到 ${stats.llm?.inserted ?? 0} 条，库里总共 ${total} 条。` };
          },        rosterRefresh: async (groupId: number) => await this.refreshRoster(groupId),        })      : null;
    // 自检：这个实例有没有拿到「把话发出去」的本事。没有的话 say_to 一定失败——启动时就该吼一声。
    if (this.tools && !opts.deliverText) {
      console.warn("[工具] 这个 service 实例没有发送器（deliverText）：say_to 会失败。检查 bot.ts / router 有没有把它传进来。");
    }
    initCost(this.db, {
      inputPerMTok: cfg.costInputPerMTok,      outputPerMTok: cfg.costOutputPerMTok,      dailyBudgetYuan: cfg.dailyBudgetYuan,    });

    // v3 开关必须显式带进抽取层：memoryCfg 是另一个对象，withOverrides 不会传过去
    (this.memoryCfg as { extractV3?: boolean }).extractV3 = (cfg as { extractV3?: boolean }).extractV3 === true;
    this.extractAdapter = opts.extractAdapter ?? (cfg.provider === "deepseek" ? this.replyAdapter : undefined);
  }  stats(): BotStats {
    return {
 ...this.counters, pendingTurns: pendingTurns(this.db) };
  }  private allowed(evt: IncomingMessage): boolean {
    if (evt.isGroup) return evt.groupId !== undefined && this.cfg.allowGroups.includes(evt.groupId);
    return this.cfg.allowPrivate.includes(evt.userId);
  }    private isWeak(memory: RecallResult): boolean {
    const top = memory.factual[0]?.breakdown.total ?? 0;
    if (memory.seeds.length === 0) return true;
    if (memory.factual.length === 0) return true;

    return top < this.memoryCfg.wakeThreshold;
  }    private asksAboutPast(text: string): boolean {

    if (/这句话|刚才|刚说|你刚|上文|上面说|我说了什么|你说了什么|我上一句|你上一句/.test(text)) {
      return false;
    }
    const PAST = /记得|忘记|忘了|那次|上次|上回|以前|之前|当年|多久了|哪次|哪年|什么时候/;
    const ASKING = /[？?]|吗|呢|什么|怎么|哪|谁|多少|几号|几个|还记不|是不是|有没有|告诉我|说说|讲讲/;
    return PAST.test(text) && ASKING.test(text);
  }    randomAnchor(exclude: string[] = []): {
 name: string;
 kind: string;
 memories: string[] } | null {
    const rows = this.db      .prepare(        `SELECT a.id AS id, a.name AS name, a.kind AS kind, COUNT(ea.event_id) AS c         FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id         GROUP BY a.id HAVING c > 0`,      )      .all() as Array<{
 id: string;
 name: string;
 kind: string;
 c: number }>;
    if (rows.length === 0) return null;

    const fresh = rows.filter((r) => !exclude.includes(r.name));
    const pool = fresh.length > 0 ? fresh : rows;
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    const evs = this.db      .prepare(        `SELECT e.* FROM events e JOIN event_anchors ea ON ea.event_id = e.id         WHERE ea.anchor_id = ? AND e.archived = 0 ORDER BY e.ts DESC LIMIT 4`,      )      .all(pick.id) as Array<Record<string, unknown>>;

    const related: Array<{
 name: string;
 weight: number;
 memories: string[] }> = [];
    try {
      const edges = this.db        .prepare(          `SELECT CASE WHEN src = ? THEN dst ELSE src END AS other, weight           FROM edges WHERE src = ? OR dst = ?           ORDER BY weight DESC LIMIT 4`,        )        .all(pick.id, pick.id, pick.id) as Array<{
 other: string;
 weight: number }>;
      for (const e of edges) {
        const a = this.db.prepare("SELECT id, name FROM anchors WHERE id = ?").get(e.other) as          | {
 id: string;
 name: string }          | undefined;
        if (!a) continue;
        const evs2 = this.db          .prepare(            `SELECT e.* FROM events e JOIN event_anchors ea ON ea.event_id = e.id             WHERE ea.anchor_id = ? AND e.archived = 0 ORDER BY e.ts DESC LIMIT 2`,          )          .all(a.id) as Array<Record<string, unknown>>;
        related.push({
          name: a.name,          weight: Number(e.weight ?? 1),          memories: evs2.map((r) => describeEvent(rowToEvent(r))),        });
      }    } catch {

    }    return {
      name: pick.name,      kind: pick.kind,      memories: evs.map((r) => describeEvent(rowToEvent(r))),      related,      stale: fresh.length === 0,    } as {
      name: string;
      kind: string;
      memories: string[];
      related: Array<{
 name: string;
 weight: number;
 memories: string[] }>;
      stale: boolean;
    };
  }    async think(
      anchor: {
        name: string;
        kind: string;
        memories: string[];
        related?: Array<{ name: string; weight: number; memories: string[] }>;
        stale?: boolean;
        repeats?: number;
      },
      opts?: { toolFilter?: (name: string) => boolean },
    ): Promise<string> {
    const lines = [
      `我忽然想到「${anchor.name}」（${anchor.kind}）。`,
      anchor.memories.length > 0 ? "关于它，我记得：" : "关于它，其实什么都想不起来了。",
      ...anchor.memories.map((m) => `- ${m}`),
      "",
    ];

    // 2026-10-27：想到「人」的时候，允许她更愿意去说话。
    // 只加一句引导，不替她决定；想到的是事/话题就不加，免得把走神全推到聊天上。
    if (anchor.kind === "person") {
      lines.push("（这次想到的是一个人。真有话想对他说，就走「聊天」）", "");
    }

    // 知识库里跟这个锚点有关的（只按锚点名匹配，不硬套主题）
    try {
      const names = [anchor.name, ...(anchor.related ?? []).map((r) => r.name)];
      const hits = kbForAnchors(this.cfg.dataDir, names, 4).map((e) => ({
        category: e.category,
        title: e.title,
        content: e.content,
      }));
      if (hits.length > 0) {
        lines.push("【知识库里跟它有关的】");
        for (const h of hits.slice(0, 4)) {
          lines.push(`- 〔${h.category}〕${h.title}：${h.content.replace(/\s+/g, " ").slice(0, 120)}`);
        }
        lines.push("");
      }
    } catch {
      // 知识库坏了不影响走神
    }

    // 有多少对话还没进记忆（限频提醒，不然会一直念叨）
    try {
      const pending = Number(
        (this.db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get() as { c?: number } | undefined)?.c ?? 0,
      );
      if (pending > 0 && canNudge(this.cfg.dataDir, "lastTidyNudge")) {
        lines.push(`【还有 ${pending} 段对话没有进记忆】`, "要不要自己整理一下？（memory_tidy）", "");
        markNudged(this.cfg.dataDir, "lastTidyNudge");
      }
    } catch {
      // 查不到就算了
    }

    // 顺着关系想到的（想到「某人」会带出「群聊」「小甜妹语录」）
    if (anchor.related && anchor.related.length > 0) {
      lines.push(`顺着「${anchor.name}」你还想到：${anchor.related.map((r) => r.name).join("、")}`, "");
      for (const r of anchor.related) {
        if (r.memories.length === 0) continue;
        lines.push(`【${r.name}】`);
        for (const m of r.memories) lines.push(`- ${m}`);
        lines.push("");
      }
      lines.push("这几件事是连着的，你只想得起来一件。能不能从它们之间得出一个新的东西？", "");
    }

    if (anchor.stale || (anchor.repeats ?? 0) >= 2) {
      lines.push(
        `「${anchor.name}」这件事你已经翻了 ${anchor.repeats ?? 2} 次了，还要继续吗？`,
        "要继续就说清这次想弄明白什么；没什么可挖的就换别的。",
        "",
      );
    }

    // 刚才在聊什么：不带这个，它会拿一个早就聊完、甚至刚被否掉的旧话题当「突然想起」
    try {
      const recent = this.db
        .prepare("SELECT role, text FROM turns ORDER BY seq DESC LIMIT 6")
        .all() as Array<{ role: string; text: string }>;
      const talked = recent
        .reverse()
        .map((r) => {
          const said = String(r.text ?? "").replace(/\s+/g, " ").slice(0, 80);
          return said.length > 0 ? `${r.role === "user" ? "他" : "我"}：${said}` : "";
        })
        .filter((x) => x.length > 0);
      if (talked.length > 0) {
        lines.push("【刚才在聊什么】", ...talked, "");
      }
      // 明确告诉她「刚才是在跟谁说话」：不然她选「聊天」时会对着错的收件人讲话
      const recentChats = recentChatTargets();
      if (recentChats.length > 0) {
        lines.push("【刚才在跟谁说话】");
        for (const c of recentChats) {
          const mins = Math.max(0, Math.round((Date.now() - c.at) / 60_000));
          lines.push(
            `- ${c.isGroup ? "群里" : "私聊"}${c.userName || c.userId}${c.isGroup && c.groupId ? `（群 ${c.groupId}）` : ""}｜${mins} 分钟前`,
          );
        }
        lines.push(
          "",
          "要开口的话，就在「给：」那行写清说给谁（写名字、QQ 号、群号，或「群里」都行）；",
          "不写就发给最近那个。人称、关系别搞错——跟谁说话，就用对谁的说法。",
          "",
        );
      }
    } catch {
      // 读不到对话就算了
    }

    // 剩下的（怎么解读这段对话 / 八问 / 三途径 / 消息模板 / 输出格式）在 data/think-prompt.md，她自己能改
    lines.push(thinkPromptBlock(this.cfg.dataDir));
    return this.act(lines.join("\n"), undefined, {
      plans: true,
      toolFilter: opts?.toolFilter ?? noPhoneTools,
      tag: "think",
    });
  }    refreshPhoneTools(): void {
    if (!this.tools) return;
    try {
      const attached = attachPhoneTools(this.tools, this.cfg);
      if (attached) {
        if (!this.phoneAttached) {
          this.phoneAttached = true;
          console.log("[手机] 手机工具接上了");
        }        return;
      }      if (this.phoneAttached) {
        const removed = detachPhoneTools(this.tools);
        this.phoneAttached = false;
        if (removed.length > 0) console.log(`[手机] 手机工具卸下：${removed.join("、")}`);
      }    } catch (err) {
      console.warn("[日志]", err instanceof Error ? err.message : String(err));
    }  }    busyRecently(withinMs = 90_000): boolean {
    // 看全局：聊天和走神是两个 service 实例，只看自己那个等于瞎
    const last = Math.max(this.lastActivityAt || 0, lastActivityMs);
    return last > 0 && Date.now() - last < withinMs;
  }    resolveApproval(shortId: string, approve: boolean): Approval | null {
    return resolveApproval(this.db, shortId, approve);
  }    async callTool(name: string, args: Record<string, unknown>): Promise<{
 ok: boolean;
 text: string } | null> {
    if (!this.tools) return null;
    return this.tools.call(name, args);
  }  /** 把一份群名册落库（OneBot get_group_member_list 的结果，整群覆盖） */
  syncGroupRoster(groupId: number | string, members: GroupMember[]): { group: string; count: number } {
    return saveGroupMembers(this.db, groupId, members);
  }  /** 这个群学过名册没有（学过就不必再拉，免得日志刷屏） */
  hasRoster(groupId: number | string): boolean {
    return hasRoster(this.db, groupId);
  }  /** 名册拉取器：bot.ts 连上 OneBot 后注入，供 group_members 工具按需刷新 */
  setRosterSource(fn: (groupId: number) => Promise<GroupMember[]>): void {
    this.rosterSource = fn;
  }  /** 现拉一次名册（工具 action=sync 用）；拿不到连接返回 null */
  async refreshRoster(groupId: number): Promise<number | null> {
    const fn = this.rosterSource;
    if (!fn) return null;
    const members = await fn(groupId);
    if (members.length === 0) return null;
    return saveGroupMembers(this.db, groupId, members).count;
  }  /** 读它自己写的那份自我描述（阅读员/走神要拿它当「我的处境」） */
  readSelfText(): string {
    try {
      return readSelf(this.cfg.dataDir);
    } catch {
      return "";
    }
  }  /** 我正在做的事（给自己看的）：最近的待办 / 需跟进 / 项目，阅读员和走神都用它当“处境” */
  openLoops(limit = 3): string[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT title FROM events
           WHERE COALESCE(archived,0) = 0
             AND (status IN ('需跟进','待确认') OR etype = '待办' OR kind = 'project')
           ORDER BY ts DESC LIMIT ?`,
        )
        .all(limit) as Array<{ title: string }>;
      return rows.map((r) => String(r.title ?? "").trim()).filter((s) => s.length > 0);
    } catch {
      return [];
    }
  }  /** 从 B 站学到的东西必须进知识库（不是记一条流水账 note 就完了） */
  rememberLearned(raw: string): { ok: boolean; title: string } | null {
    const line = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (line.length < 4) return null;
    const bv = /BV[0-9A-Za-z]{8,12}/.exec(line)?.[0] ?? "";
    const rest = line.replace(bv, "").replace(/^[\s\-—－:：·]+/, "").trim();
    const parts = rest.split(/\s*[—－]{1,2}\s*|\s*--\s*/);
    const title = String(parts[0] ?? rest).trim().slice(0, 40);
    const content = (parts.slice(1).join("；").trim() || rest).slice(0, 400);
    if (title.length < 2) return null;
    try {
      const known = (this.db.prepare("SELECT name FROM anchors").all() as Array<{ name: string }>).map((r) => r.name);
      addKnowledge(this.cfg.dataDir, {
        category: "B站",
        title,
        content,
        source: bv || "B站",
        knownAnchors: known,
      });
      return { ok: true, title };
    } catch {
      return null;
    }
  }  /** 把这份对话历史缓存丢掉，下次 historyFor 从 turns 表重读 */
  forgetHistory(): void {
    this.history.clear();
  }    private historyFor(sessionId: string): Array<{
 role: "user" | "assistant";
 text: string;
 speaker?: string }> {
    const cached = this.history.get(sessionId);
    if (cached && cached.length > 0) return cached;
    try {
      // 只捞这个会话自己的话：以前这条查询压根没按 session 过滤，
      // 于是一进群，历史里装的是全库最近 50 条（连私聊都在里面）——2026-10-27 群里那团乱的主因。
      const rows = this.db
        .prepare("SELECT role, text, speaker_id FROM turns WHERE session_id = ? ORDER BY seq DESC LIMIT ?")
        .all(sessionId, HISTORY_LIMIT) as Array<{
 role: string;
 text: string;
 speaker_id: string }>;
      if (rows.length === 0) return [];

      const nameOf = new Map<string, string>();
      try {
        for (const p of listPeople(this.db)) nameOf.set(p.qqId, p.name || p.qqId);
      } catch {

      }      const restored = rows        .reverse()        .map((r) => ({
          role: (r.role === "user" ? "user" : "assistant") as "user" | "assistant",          text: String(r.text ?? ""),          speaker: r.role === "user" ? nameOf.get(String(r.speaker_id ?? "")) ?? "" : "",        }))        .filter((m) => m.text.length > 0);
      this.history.set(sessionId, restored);
      console.log(`[历史] 从库里捞回 ${restored.length} 条（${sessionId}）`);
      return restored;
    } catch {
      return [];
    }  }    recordSaid(text: string, sessionId = "autonomy"): void {
    const t = String(text ?? "").trim();
    if (t.length === 0) return;
    try {
      ingestTurns(this.db, [{
 day: dayKey(Date.now()), role: "assistant", text: t, speakerId: String(this.cfg.selfId), sessionId }]);
    } catch {

    }
    // 自己说的话刚落进 turns 表：把各实例的历史缓存清掉，
    // 否则聊天那边还拿着一份没有这句的旧缓存（走神说的话它就永远看不见）。
    dropHistoryCaches();  }    alwaysOnMemories(limit = 8, speakerId = ""): Array<{
 kind: string;
 text: string }> {
    try {

      const rules = this.db        .prepare("SELECT kind, title, detail FROM events WHERE archived = 0 AND kind = 'feedback' ORDER BY ts DESC LIMIT ?")        .all(limit) as Array<{
 kind: string;
 title: string;
 detail: string }>;
      const about = speakerId        ? (this.db            .prepare(              "SELECT kind, title, detail FROM events WHERE archived = 0 AND kind = 'user' AND speaker_id = ? ORDER BY ts DESC LIMIT ?",            )            .all(speakerId, limit) as Array<{
 kind: string;
 title: string;
 detail: string }>)        : [];
      return [...about, ...rules].map((r) => ({
 kind: r.kind, text: String(r.title || r.detail).slice(0, 90) }));
    } catch {
      return [];
    }  }    learnTerm(term: string, meaning: string): boolean {
    try {
      return learnTerm(this.cfg.dataDir, term, meaning, "学到的");
    } catch {
      return false;
    }  }    liveStats(): {
 events: number;
 anchors: number;
 edges: number;
 pending: number } {
    const one = (sql: string): number => Number((this.db.prepare(sql).get() as {
 c?: number } | undefined)?.c ?? 0);
    return {
      events: one("SELECT COUNT(*) AS c FROM events WHERE archived = 0"),      anchors: one("SELECT COUNT(*) AS c FROM anchors"),      edges: one("SELECT COUNT(*) AS c FROM edges"),      pending: one("SELECT COUNT(*) AS c FROM turns WHERE processed = 0"),    };
  }    recordThoughtNote(input: {
 anchor: string;
 related: string[];
 goal: string;
 channel: string;
 message?: string }): void {
    try {
      recordThought(this.db, input, Date.now());
    } catch {

    }  }    proactiveUsedToday(): number {
    return quotaUsed(this.db, "proactive");
  }    countProactive(): void {
    quotaSpend(this.db, "proactive", this.cfg.proactiveDailyLimit);
  }    async speakUp(info: {
 idleMinutes: number;
 used: number;
 limit: number }): Promise<string> {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return this.act(
      [
        "他已经很久没有说话了，你要不要主动找他聊聊？聊什么内容你自己定。",
        `现在是 ${hh}:${mm}。`,
        info.limit > 0
          ? `你今天已经主动找过他 ${info.used} 次（上限 ${info.limit} 次）。`
          : `你今天已经主动找过他 ${info.used} 次，没有次数限制。`,
        "",
        "有想说的，就跟他聊聊，用你自己的方式。",
        "",
        "要发到某个群、或者某个人，第一行写「发到：群号或名字」，第二行开始才是话；不写就发最近的会话。",
        "可以说你刚看到的东西、想到的事，或者一句真心的关心。",
        "",
        "如果这阵子有**想做成但自己做不到的事**、或者想要点什么（一个能力、一个工具、他的帮忙），现在是个好时机说出来。",
        "不想说就只回：沉默",
      ].join("\n"),
    );
  }      recordNote(text: string): void {
    try {
      recordOwnNote(this.db, text, Date.now());
    } catch (err) {
      console.warn("[日志]", err instanceof Error ? err.message : String(err));
    }  }    toolRegistry(): ToolRegistry | null {
    return this.tools;
  }    private knownText(): string {
    const t = this.todaySnapshot();
    return [readSelf(this.cfg.dataDir), t.watched.join("\n"), t.notes.join("\n")].join("\n");
  }    todaySnapshot(): {
 watched: string[];
 notes: string[] } {
    const today = new Date().toISOString().slice(0, 10);
    const watched = this.watchedToday();
    const noteRows = this.db      .prepare("SELECT title FROM events WHERE day = ? AND context_kinds LIKE ? ORDER BY ts DESC")      .all(today, "%own-note%") as Array<{
 title: string }>;
    return {
 watched, notes: noteRows.map((r) => r.title) };
  }    watchedToday(): string[] {
    const today = new Date().toISOString().slice(0, 10);
    const rows = this.db      .prepare("SELECT bvid, title FROM watched_videos WHERE day = ? ORDER BY watched_at DESC")      .all(today) as Array<{
 bvid: string;
 title: string }>;
    return rows.map((r) => (r.title.length > 0 ? r.title : r.bvid));
  }    autonomyBudget(): {
    videoLeft: number;
    videoLimit: number;
    videoUsed: number;
    videoUnlimited: boolean;
    writeLeft: number;
    writeLimit: number;
    writeUsed: number;
    writeUnlimited: boolean;
    roundsLeft: number;
    roundsLimit: number;
  } {
    const videoLimit = this.cfg.biliDailyVideoQuota;
    const writeLimit = this.cfg.biliDailyWriteLimit;
    const roundsLimit = this.cfg.autonomyDailyRounds;
    // 0 的语义是「不限」（聊天提示词一直这么解释），但以前这里算成 max(0, 0 - used) = 0，
    // 于是自主活动被告知「今天还能读 0 个视频」，阅读员一整天只翻标题、一条字幕不读。
    const videoUnlimited = videoLimit <= 0;
    const writeUnlimited = writeLimit <= 0;
    const videoUsed = quotaUsed(this.db, "video");
    const writeUsed = quotaUsed(this.db, "write");
    return {
      videoLeft: videoUnlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, videoLimit - videoUsed),
      videoLimit,
      videoUsed,
      videoUnlimited,
      writeLeft: writeUnlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, writeLimit - writeUsed),
      writeLimit,
      writeUsed,
      writeUnlimited,
      roundsLeft: roundsLimit <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, roundsLimit - quotaUsed(this.db, "autonomy")),
      roundsLimit,    };
  }    /**
   * 到点的计划主动送一次：不再等「走神刚好没被挡住」。
   * 返回送出去的文本（没到点就返回空串）。由 bot.ts 的定时器每 90 秒调一次。
   */
  async deliverDuePlans(): Promise<string> {
    try {
      const due = duePlans(this.db);
      if (due.length === 0) return "";
      const block = planPromptBlock(due);
      for (const p of due) markReminded(this.db, p.id);
      console.log(`[plan] 送到点的计划 ${due.length} 条：${due.map((p) => p.what.slice(0, 18)).join("、")}`);
      const out = await this.act(
        [block, "", "（这是你自己之前定下的计划，到点了。做不做、要不要改时间，你自己定。）"].join("\n"),
      );
      return String(out ?? "");
    } catch (err) {
      console.error("[plan] 送计划提醒失败:", err instanceof Error ? err.message : String(err));
      return "";
    }
  }

  /** 给投递解析用的库句柄（只读语义，别在这儿写） */
  dbHandle(): DatabaseSync {
    return this.db;
  }

  async act(instruction: string, maxRounds?: number, opts: { plans?: boolean; toolFilter?: (name: string) => boolean; tag?: string } = {}): Promise<string> {
    this.lastActivityAt = Date.now();
    touchActivity(this.lastActivityAt);
    const budget = this.autonomyBudget();
    const memory = recall(this.db, this.memoryCfg, instruction.slice(0, 60), {
 sessionId: "autonomy" });
    const messages = buildChatPrompt({
      memory,      userName: "对方",      history: [],      message: instruction,      memoryWeak: false,      ...this.promptExtras(undefined, opts),    });
    // 轮次：调用方没指定就用她自己那份 actRounds（回话用 replyRounds）
    const rounds = maxRounds ?? loadTuning(this.cfg.dataDir).actRounds;
    const out = await this.respond(messages, rounds, opts.toolFilter, opts.tag ?? "act");
    // 额度撞墙时那句不是她的话：当「这次没话说」，别让它变成手记/记忆
    return blockedByBudget(out.text) ? "" : out.text;
  }    /**
   * 场景：私聊还是群、群号多少、这两天群里谁说过话。
   * 聊天、主动开口、调试都走这一份实现——以前两处各写一份，改了一处另一处不生效。
   */
  private sceneOf(evt?: IncomingMessage | { isGroup?: boolean; groupId?: number }): string {
    const groups = this.groupsLine();
    const tail = groups.length > 0 ? `\n${groups}` : "";
    if (!evt?.isGroup) return `私聊。只有你和他说话。${tail}`;
    const head = `QQ 群，群号 ${evt.groupId ?? "未知"}。这是群里，不是私聊。群里还有别人在看。`;
    // 名单：这两天在群里说过话的人（最多 12 个）。有 session_id 之后就只算这个群的；
    // 老行没有 session，查不到就退回全库——宁可名单宽一点，也别把一个群的人全丢掉。
    try {
      const since = Date.now() - 2 * 86_400_000;
      let rows = this.db
        .prepare("SELECT DISTINCT speaker_id FROM turns WHERE speaker_id <> '' AND ts > ? AND session_id LIKE ?")
        .all(since, `group:${evt.groupId ?? ""}%`) as Array<{ speaker_id: string }>;
      if (rows.length === 0) {
        rows = this.db
          .prepare("SELECT DISTINCT speaker_id FROM turns WHERE speaker_id <> '' AND ts > ?")
          .all(since) as Array<{ speaker_id: string }>;
      }
      const nameOf = new Map(listPeople(this.db).map((p) => [p.qqId, p.name]));
      const names = [
        ...new Set(
          rows.map((r) => nameOf.get(r.speaker_id) ?? r.speaker_id).filter((n) => n.length > 0),
        ),
      ].slice(0, 12);
      if (names.length > 0) return `${head}这两天在群里说过话的有：${names.join("、")}。${tail}`;
    } catch {
      // 名单查不到就算了
    }
    return `${head}${tail}`;
  }

  /**
   * 我在的群：群号 + 名册人数。
   * 以前这一行只存在于 group_policy 工具的输出里，提示词里没有——
   * 于是让他「去群里水水」时，她的认知里根本没有群。
   */
  private groupsLine(): string {
    const allow = this.cfg.allowGroups ?? [];
    if (allow.length === 0) return "";
    const counts = new Map<string, number>();
    try {
      const rows = this.db
        .prepare("SELECT group_id, COUNT(*) AS c FROM group_members GROUP BY group_id")
        .all() as Array<{ group_id: string; c: number }>;
      for (const r of rows) counts.set(String(r.group_id), Number(r.c));
    } catch {
      // 名册查不到就只报群号
    }
    const list = allow.map((gid) => {
      const n = counts.get(String(gid));
      return n && n > 0 ? `${gid}（${n} 人）` : String(gid);
    });
    return `我在的群：${list.join("、")}。想往哪个群说话，就把群号写出来。`;
  }    private promptExtras(evt?: {
 isGroup?: boolean;
 groupId?: number;
 userId?: number;
 userName?: string;
 sender?: {
 card?: string;
 nickname?: string } }, opts: { plans?: boolean; toolFilter?: (name: string) => boolean } = {}): {
    toolNames?: string[];
    selfText: string;
    quota: {
 videoUsed: number;
 videoLimit: number;
 writeUsed: number;
 writeLimit: number };
    today: {
 watched: string[];
 notes: string[]; planBlock?: string };
  } {
    return {
      toolNames: (this.tools?.names() ?? []).filter((n) => !opts.toolFilter || opts.toolFilter(n)),      selfText: readSelf(this.cfg.dataDir),      // 计划表：到点的推到她眼前，然后记一次提醒（下次按间隔再推）
      planBlock: (() => {
        if (!opts.plans || evt) return "";
        try {
          const due = duePlans(this.db);
          if (due.length === 0) return "";
          const block = planPromptBlock(due);
          for (const p of due) markReminded(this.db, p.id);
          return block;
        } catch {
          return "";
        }
      })(),
      today: this.todaySnapshot(),      quota: {
        videoUsed: quotaUsed(this.db, "video"),        videoLimit: this.cfg.biliDailyVideoQuota,        writeUsed: quotaUsed(this.db, "write"),        writeLimit: this.cfg.biliDailyWriteLimit,      },
      scene: this.sceneOf(evt),      currentSpeaker: (() => {
        const c = String(evt?.sender?.card ?? "").trim();
        const n = String(evt?.sender?.nickname ?? "").trim();
        return c || n || String(evt?.userName ?? evt?.userId ?? "");
      })(),      currentSpeakerQq: String(evt?.userId ?? ""),
      // 谁是谁 + 我自己的号：群里的 @ 在文字里只剩一个号码，
      // 不给她这张对照表，它连「@的是我还是别人」都分不出来（答成「@我干嘛」）。
      people: (() => {
        try {
          return listPeople(this.db);
        } catch {
          return [];
        }
      })(),      peopleQq: String(evt?.userId ?? ""),      selfQq: String((evt as { selfId?: number } | undefined)?.selfId ?? this.cfg.selfId ?? ""),
      // 群里都有谁：名册一行（人多时只给几个名字，要全部去调 group_members）
      groupRoster: (() => {
        try {
          if (!evt?.isGroup || evt.groupId === undefined) return "";
          return rosterLine(this.db, evt.groupId, listPeople(this.db).map((p) => p.name));
        } catch {
          return "";
        }
      })(),
      // 角色 → 内容：这个人和被 @ 的人「说过什么、什么事关于他」，
      // 挂在【谁是谁】每行下面，光有号码→名字还不够它理解上下文。
      personCards: personCardsFor(this.db, (() => {
        const raw = String((evt as { text?: string } | undefined)?.text ?? "");
        const ids: string[] = [
          String(evt?.userId ?? ""),
          // 她自己也带一张：至少知道自己刚说过什么，别前后打架
          String((evt as { selfId?: number } | undefined)?.selfId ?? this.cfg.selfId ?? ""),
        ];
        for (const m of raw.matchAll(/\[CQ:at,qq=(\d+)/g)) ids.push(m[1]!);
        for (const m of raw.matchAll(/@(\d{5,})/g)) ids.push(m[1]!);
        return ids;
      })(), 2),
      // 读心结果（router 挂上来的），没有就是 null
      mind: (evt as { mind?: { surface: string; emotion: string; myReaction: string } | null } | undefined)?.mind ?? null,    };
  }    private async respond(    messages: Array<{
 role: "system" | "user" | "assistant";
 content: string }>,    maxRounds = 0,    toolFilter?: (name: string) => boolean,    tag = "reply",  ): Promise<{
 text: string;
 toolText: string }> {

    const cost = todayCost();
    if (cost.exhausted) {
      return {
 text: `今天的额度用完了（${cost.budgetYuan} 块，已花 ${cost.yuan} 块）。明天再说。`, toolText: "" };
    }    if (this.tools && this.cfg.provider === "deepseek") {
      const result = await runChatWithTools(        {
          baseUrl: this.cfg.deepseekBaseUrl,          apiKey: this.cfg.deepseekApiKey,          model: this.cfg.deepseekModel,          temperature: loadTuning(this.cfg.dataDir).replyTemperature,          timeoutMs: 90_000,        },        messages,        this.tools,        maxRounds,        toolFilter,        tag,      );
      if (result.calls.length > 0) {
        this.counters.toolCalls += result.calls.length;
      }
      return {
 text: result.text, toolText: result.calls.map((c) => c.result).join("\n") };
    }    return {
 text: (await this.replyAdapter.complete(messages, {
 timeoutMs: 120_000 })).trim(), toolText: "" };
  }    async say(text: string, userName = "本人", evt?: IncomingMessage): Promise<{
 reply: string;
 memory: string }> {
    const memory = recall(this.db, this.memoryCfg, text, {
 sessionId: "debug" });
    const weak = this.isWeak(memory) && this.asksAboutPast(text);
    const extras = this.promptExtras(evt);
    const messages = buildChatPrompt({
      ...extras,
      memory,      userName,      history: [],      message: text,      memoryWeak: weak,      people: (() => {
        try {
          return listPeople(this.db);
        } catch {
          return [];
        }      })(),      peopleQq: "",      selfQq: String(this.cfg.selfId ?? ""),      currentSpeakerQq: "",      currentSpeaker: (() => {
        const s = evt?.sender;
        const c = String(s?.card ?? "").trim();
        const n = String(s?.nickname ?? "").trim();
        return c || n || String(evt?.userName ?? userName);
      })(),
      scene: this.sceneOf(evt),      stats: this.liveStats(),      alwaysOn: this.alwaysOnMemories(8, ""),      uptime: describeUptime(readUptime(this.cfg.dataDir)),      terms: matchTerms(this.cfg.dataDir, text),    });
    const out = await this.respond(messages, loadTuning(this.cfg.dataDir).replyRounds);
    let reply = String(out.text ?? "").trim();
    if (weak && this.asksAboutPast(text) && looksFabricated(reply, `${memory.contextBlock}\n${out.toolText}\n${this.knownText()}`)) {
      if (out.toolText.length > 0) {
        console.warn("[日志] 这轮有工具结果托底，原文留着不换");
      } else {
        reply = `${noMemoryReply()}（原回答含未记载的具体事实，已拦下）`;
      }    }    return {
 reply, memory: memory.contextBlock };
  }    async handle(evt: IncomingMessage): Promise<string | null> {
    this.lastActivityAt = Date.now();
    touchActivity(this.lastActivityAt);
    // 记住「刚才在跟谁说话」：走神想开口时按它选投递目标，别一律发主人私聊
    try {
      noteChatTarget({
        isGroup: Boolean(evt.isGroup),
        groupId: evt.groupId,
        userId: evt.userId,
        userName: String(evt.userName ?? ""),
      });
    } catch {
      // 记不住就算了
    }

    try {

      const sender = (evt as {
 sender?: {
 card?: string;
 nickname?: string } }).sender;
      const card = String(sender?.card ?? "").trim();
      const nick = String(sender?.nickname ?? "").trim();
      const finalName = card || nick || String(evt.userName ?? evt.userId);
      ensurePerson(this.db, evt.userId, finalName);

      if (card && nick && card !== nick) addAlias(this.db, String(evt.userId), nick);
    } catch {

    }    this.counters.received += 1;
    this.lastMessageAt = Date.now();
    if (evt.userId === evt.selfId) {
      this.counters.ignored += 1;
      return null;
    }
    const imageFiles: string[] = [];
        // 上一轮没发出去的图别带到这一轮
        clearPendingImages();
        const seenText = await describeImagesInText(evt.text, this.cfg.dataDir, imageFiles, this.cfg);
        if (imageFiles.length > 0) setPendingImages(imageFiles);
    const text = describeCqCodes(seenText).trim();
    if (text.length === 0) {
      this.counters.ignored += 1;
      return null;
    }    if (!this.allowed(evt)) {
      this.counters.ignored += 1;
      return this.cfg.strangerReply.length > 0 ? this.cfg.strangerReply : null;
    }
    const groupMode =      evt.isGroup && evt.groupId !== undefined        ? modeFor(this.cfg.dataDir, evt.groupId, this.cfg.groupReplyMode)        : this.cfg.groupReplyMode;
    if (evt.isGroup && groupMode === "mention" && evt.mentioned !== true) {
      if (this.cfg.recordGroupChat) {
        try {
          ingestTurns(this.db, [{
 day: dayKey(Date.now()), role: "user", text, speakerId: String(evt.userId), sessionId: evt.sessionId }]);
        } catch {

        }      }      this.counters.ignored += 1;
      return null;
    }
    try {
      ingestTurns(this.db, [{
 day: dayKey(Date.now()), role: "user", text, speakerId: String(evt.userId), sessionId: evt.sessionId }]);
    } catch (err) {
      console.error("[日志]", err);
    }
    let memory: RecallResult;
    // 检索用的查询串必须提到 try 外面：重试那一步（第一轮回得太短）也要用它。
    // 之前声明在 try 里，等于给「短回复」埋了一颗 ReferenceError，一炸就退成兜底句。
    let recallQuery = text;
    try {

    const ctxTail = withoutCurrent(this.historyFor(evt.sessionId), text)      .slice(-2)      .map((h) => h.text)      .join(" ")      .slice(-120);
    recallQuery = `${ctxTail} ${text}`.trim();
    memory = recall(this.db, this.memoryCfg, recallQuery, {
 sessionId: evt.sessionId, speakerId: String(evt.userId) });
    } catch (err) {
      console.error("[日志]", err);
      this.counters.failed += 1;
      return fallbackReply();
    }
    const weak = this.isWeak(memory) && this.asksAboutPast(text);
    const messages = buildChatPrompt({
      memory,      userName: evt.userName,      history: withoutCurrent(this.historyFor(evt.sessionId), text),      message: text,      memoryWeak: weak,      stats: this.liveStats(),      ...this.promptExtras(evt),    });
    let reply: string;
    let toolText = "";
    try {
      const out = await this.respond(messages, loadTuning(this.cfg.dataDir).replyRounds);
      // 宽松重试：第一轮什么都没生成出来（或者只有一句兜底），
      // 说明按前几个锚点想不出东西——放宽召回再试一次。
      if (String(out.text).trim().length < 4) {
        const wider = recall(this.db, this.memoryCfg, recallQuery, {
          sessionId: evt.sessionId,
          speakerId: String(evt.userId),
          allowMore: true,
        } as never);
        const retry = buildChatPrompt({
          memory: wider,
          userName: evt.userName,
          history: withoutCurrent(this.historyFor(evt.sessionId), text),
          message: text,
          memoryWeak: weak,
          stats: this.liveStats(),
          ...this.promptExtras(evt),
        });
        const out2 = await this.respond(retry, loadTuning(this.cfg.dataDir).replyRounds);
        if (String(out2.text).trim().length > 0) {
          out.text = out2.text;
          toolText = out2.toolText;
        }
      }
      reply = String(out.text ?? "").trim();
      toolText = out.toolText;
      if (reply.length === 0) throw new Error("空回复");
    } catch (err) {
      console.error("[日志]", err);
      this.counters.failed += 1;
      return fallbackReply();
    }
    if (this.opts.onImage) {
      const shot = /(<path>)?([A-Za-z]:\\\\[^\s"']+shot-\d+\.png|data[\\\\/]screenshots[\\\\/]shot-\d+\.png)/.exec(toolText || "");
      if (shot) {
        try {
          await this.opts.onImage(shot[2]!);
        } catch (err) {
          console.warn("[日志]", err instanceof Error ? err.message : String(err));
        }      }    }    if (weak && this.asksAboutPast(text) && looksFabricated(reply, `${memory.contextBlock}\n${toolText}\n${this.knownText()}`)) {
      console.warn("[日志] 拦下一个没有记忆支撑的回答");
      this.counters.failed += 1;
      reply = noMemoryReply();
    }
    const hist = this.historyFor(evt.sessionId);
    hist.push({
 role: "user", text });
    // 额度撞墙那句不是她说的：照旧发出去让她看见，但不进历史、不落库——否则她会连着几天背旧账
    if (!blockedByBudget(reply)) {
      hist.push({
 role: "assistant", text: reply });
    }
    this.history.set(evt.sessionId, hist.slice(-HISTORY_LIMIT));

    if (!blockedByBudget(reply)) {
      try {
        ingestTurns(this.db, [{
 day: dayKey(Date.now()), role: "assistant", text: reply, speakerId: String(this.cfg.selfId), sessionId: evt.sessionId }]);
      } catch (err) {
        console.error("[日志]", err);
      }
    }    console.log(`[消息] ${evt.userName}: ${text.slice(0, 60)}`);
    console.log(`[回复] ${reply.slice(0, 80)}`);
    touchActivity(); // 回完话也算「刚动过」，走神别马上插进来
    this.counters.replied += 1;
    return reply;
  }    async sleepNow(now = Date.now()): Promise<SleepStats | null> {
    if (this.sleeping) return null;
    this.sleeping = true;
    try {
      const stats = await sleepAsync(this.db, this.memoryCfg, {
 nowTs: now }, this.extractAdapter);
      this.counters.sleeps += 1;
      this.counters.lastSleepAt = now;
      return stats;
    } finally {
      this.sleeping = false;
    }  }    async maybeSleep(now = Date.now()): Promise<SleepStats | null> {
    if (this.sleeping) return null;
    if (pendingTurns(this.db) === 0) return null;
    const today = dayKey(now);
    const hour = new Date(now).getHours();
    const idleShort =      this.cfg.idleSleepMinutes > 0 && now - this.lastMessageAt >= this.cfg.idleSleepMinutes * 60_000;
    const idleHit = this.cfg.idleSleepHours > 0 && now - this.lastMessageAt >= this.cfg.idleSleepHours * 3_600_000;

    const win = this.cfg.dailySleepWindow;
    const inWindow =      win !== null && (win[0] <= win[1] ? hour >= win[0] && hour < win[1] : hour >= win[0] || hour < win[1]);
    const dailyHit =      (inWindow || (this.cfg.dailySleepHour !== null && hour === this.cfg.dailySleepHour)) &&      this.lastSleepDay !== today;

    const pendingNow = pendingTurns(this.db);
    const pendingHit = this.cfg.sleepForceThreshold > 0 && pendingNow >= this.cfg.sleepForceThreshold;
    if (!idleShort && !idleHit && !dailyHit && !pendingHit) return null;

    if (pendingHit && this.cfg.announceSleep && !idleShort) {
      try {
        this.opts.notify?.(`有点困了，我去睡一会儿——白天攒了 ${pendingNow} 条对话，得理一理。醒了再聊。`);
      } catch {

      }    }
    if (dailyHit) {
      this.db.prepare("UPDATE turns SET processed = 0 WHERE day = ?").run(today);
    }    this.sleeping = true;
    try {
      const stats = await sleepAsync(this.db, this.memoryCfg, {
 nowTs: now }, this.extractAdapter);
      this.counters.sleeps += 1;
      this.counters.lastSleepAt = now;
      this.lastSleepDay = today;
      console.log("[睡眠] 整理完了");
      return stats;
    } catch (err) {
      console.error("[日志]", err);
      return null;
    } finally {
      this.sleeping = false;
    }  }    startScheduler(intervalMs = 60_000): () => void {
    const timer = setInterval(() => {
      void this.maybeSleep();
    }, intervalMs);
    return () => clearInterval(timer);
  }  close(): void {
    liveServices.delete(this);
    this.db.close();
  }}export function createChatAdapter(cfg: BotConfig): LlmAdapter {
  if (cfg.provider === "deepseek") {
    return new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);
  }  return new OllamaAdapter(cfg.ollamaBaseUrl, cfg.ollamaModel);
}export function makeFakeReplyAdapter(text: string): LlmAdapter {
  return {
 name: "fake", complete: async () => text };
}