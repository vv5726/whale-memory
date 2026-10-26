import type {
 DatabaseSync }
 from "node:sqlite";
import type {
 MemoryConfig, RecallResult, SleepStats }
 from "../types.ts";
import {
 DEFAULT_CONFIG, withOverrides }
 from "../config.ts";
import {
 openDb, rowToEvent }
 from "../db.ts";
import {
 ingestTurns }
 from "../extract.ts";
import {
 pendingTurns, sleepAsync }
 from "../sleep.ts";
import {
 recall, describeEvent }
 from "../recall.ts";
import {
 seedFromFile }
 from "../eval.ts";
import {
 dayKey }
 from "../util.ts";
import {
 OllamaAdapter, OpenAiCompatibleAdapter, type LlmAdapter }
 from "../llm/adapter.ts";
import {
 buildChatPrompt, fallbackReply, looksFabricated, noMemoryReply }
 from "./persona.ts";
import {
 attachPhoneTools, buildTools, detachPhoneTools }
 from "../tools/index.ts";
import {
 readSelf, ensureSelfSeed }
 from "../self.ts";
import {
 recordOwnNote, recordThought }
 from "../notes.ts";
import {
 addAlias, ensurePerson, listPeople, resolvePerson }
 from "../people.ts";
import {
 describeCqCodes }
 from "../cqcode.ts";
import {
 describeImagesInText }
 from "../vision.ts";
import {
 modeFor }
 from "../group-policy.ts";
import {
 learnTerm, matchTerms }
 from "../lexicon.ts";
import {
 addKnowledge, kbForAnchors, linkKnowledge, listCategories, searchKnowledge }
 from "../knowledge.ts";
import {
 askMentor, takeReplies }
 from "../mentor.ts";
import {
 settleByScore }
 from "../settle-score.ts";
import {
 pinMemory }
 from "../pin.ts";
import {
 aboutPerson }
 from "../about-person.ts";
import {
 listMemories }
 from "../list-memories.ts";
import {
 loadTuning, saveTuning }
 from "../tuning.ts";
import {
 describeUptime, readUptime }
 from "../uptime.ts";
import {
 canNudge, markNudged }
 from "../reminders.ts";
import {
 initCost, todayCost }
 from "../cost.ts";
import {
 resolveApproval, type Approval }
 from "../approvals.ts";
import {
 quotaUsed, quotaSpend }
 from "../quota.ts";
import {
 runChatWithTools }
 from "../llm/toolchat.ts";
import type {
 ToolRegistry }
 from "../tools/registry.ts";
import type {
 BotConfig }
 from "./config.ts";
export interface IncomingMessage {
  /** 会话标识：私聊 private:uid，群聊 group:gid:user:uid */  sessionId: string;
  userId: number;
  userName: string;
  text: string;
  isGroup: boolean;
  groupId?: number;
  /** 群里是否 @ 了机器人 */  mentioned?: boolean;
  /** 机器人自己的 QQ 号 */  selfId: number;
}
export interface BotStats {
  received: number;
  replied: number;
  ignored: number;
  failed: number;
  sleeps: number;
  toolCalls: number;
  lastSleepAt: number | null;
  pendingTurns: number;
}
const HISTORY_LIMIT = 50;
/** * QQ 机器人的核心逻辑，和传输层无关。 * * 传输层（OneBot WebSocket）只管收发，所有「记忆怎么用」的判断都在这里， * 这样不用连真 QQ 也能把整条链路测通。 */export class BotService {
  private db: DatabaseSync;
  private cfg: BotConfig;
  private memoryCfg: MemoryConfig;
  private replyAdapter: LlmAdapter;
  private extractAdapter?: LlmAdapter;
  private history = new Map<string, Array<{
 role: "user" | "assistant";
 text: string;
 speaker?: string }
>>();
  private lastMessageAt = Date.now();
  private lastSleepDay = "";
  private tools: ToolRegistry | null;
  private opts: {
 onImage?: (filePath: string) => void | Promise<void>;
 notify?: (text: string) => void }
;
  private sleeping = false;
  private counters = {
    received: 0,    replied: 0,    ignored: 0,    failed: 0,    sleeps: 0,    toolCalls: 0,    lastSleepAt: null as number | null,  }
;
  constructor(    cfg: BotConfig,    opts: {
      replyAdapter?: LlmAdapter;
      extractAdapter?: LlmAdapter;
      db?: DatabaseSync;
      /** 工具产出了图片文件时，用它把图发出去（qq-bridge 有媒体管道，我们补上） */      onImage?: (filePath: string) => void | Promise<void>;
      /** 想主动说一句话时用它（睡觉前的招呼、请示等） */      notify?: (text: string) => void;
    }
 = {
}
,  ) {
    this.opts = opts;
    this.cfg = cfg;
    this.memoryCfg = withOverrides(DEFAULT_CONFIG, {
      contextBudgetTokens: cfg.contextBudgetTokens,      extractor: cfg.useLlmExtractor ? "llm" : "heuristic",      llmBaseUrl: cfg.ollamaBaseUrl,      llmModel: cfg.ollamaModel,    }
);
    this.db = opts.db ?? openDb(cfg.memoryDb);
    // 不再往业务库里灌演示锚点：真实使用的锚点应该从对话里自己长出来。    // （要留种子锚点的话，在配置里填 seedAnchorsFile）
this.replyAdapter = opts.replyAdapter ?? createChatAdapter(cfg)
;
    this.tools = cfg.toolsEnabled      ? buildTools(cfg, this.db, opts.notify, {
          // 它自己判断某件事值得记，就直接存
save: (text) =>
{
            try {
              recordOwnNote(this.db, text, Date.now());
              return {
 ok: true, text: `存下了：${text.slice(0, 30)}` }
;
            }
 catch (err) {
              return {
 ok: false, text: `存不进：${err instanceof Error ? err.message : String(err)}` }
;
            }
          }
,          // 它自己想整理一次（等于睡一觉）
db: this.db,          countLive: () => Number(this.db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0),          snapshot: (rows) =>
{
            try {
              const line = rows.map((r) => JSON.stringify({
 at: Date.now(), id: r.id, title: r.title, detail: r.detail }
)).join("\n");
              (globalThis as {
 __forgotten?: string[] }
).__forgotten?.push(line);
            }
 catch {
              // 存不进就算了，不能因为备份失败而不删
}
          }
,          getTuning: () => loadTuning(this.cfg.dataDir),          setTuning: (t) => saveTuning(this.cfg.dataDir, t),          pin: (input) => pinMemory(this.db, input),          why: (query) => {
            const r = recall(this.db, this.memoryCfg, query || "最近的事", {
 sessionId: "why" }
);
            return r.scored ?? [];
          }
,          about: (input) => aboutPerson(this.db, input),          listMemories: (opts) => listMemories(this.db, opts),          settle: (threshold) => settleByScore(this.db, threshold),          mentorAsk: (question, context) => {
            askMentor(this.cfg.dataDir, question, context ?? "");
            return {
 ok: true, text: "发给顾问了。你先干别的，回复会在之后的对话里出现。" }
;
          }
,          mentorReplies: () => takeReplies(this.cfg.dataDir).map((r) => ({
 answer: r.answer }
)),          kbAdd: ({
 category, title, content, source, anchors }
) => {
            const known = (this.db.prepare("SELECT name FROM anchors").all() as Array<{
 name: string }
>).map((r) => r.name);
            const e = addKnowledge(this.cfg.dataDir, {
 category, title, content, source, anchors, knownAnchors: known }
);
            return {
 ok: true, text: `收进「${e.category}」：${e.title}` }
;
          }
,          kbSearch: (query) => searchKnowledge(this.cfg.dataDir, query).map((e) => ({
 category: e.category, title: e.title, content: e.content, source: e.source }
)),          kbList: () => listCategories(this.cfg.dataDir),          kbLink: (title, anchor, remove) => linkKnowledge(this.cfg.dataDir, title, anchor, remove),          learn: (term, meaning) => learnTerm(this.cfg.dataDir, term, meaning, "学到的"),          lookup: (term) => matchTerms(this.cfg.dataDir, term).find((t) => t.term === term)?.meaning,          tidy: async () => {
            const stats = await this.sleepNow();
            if (!stats) return {
 ok: false, text: "刚刚整理过了，或者没有待整理的东西" }
;
            const total = Number(this.db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
            return {
 ok: true, text: `整理完了：这次抽到 ${stats.llm?.inserted ?? 0} 条，现在总共 ${total} 条记忆` }
;
          }
,        }
)      : null;
    initCost(this.db, {
      inputPerMTok: cfg.costInputPerMTok,      outputPerMTok: cfg.costOutputPerMTok,      dailyBudgetYuan: cfg.dailyBudgetYuan,    }
);
    // 抽取也走同一个后端：API 模型的抽取质量明显高于本地 8b
this.extractAdapter = opts.extractAdapter ?? (cfg.provider === "deepseek" ? this.replyAdapter : undefined)
;
  }
  stats(): BotStats {
    return {
 ...this.counters, pendingTurns: pendingTurns(this.db) }
;
  }
  private allowed(evt: IncomingMessage): boolean {
    if (evt.isGroup) return evt.groupId !== undefined && this.cfg.allowGroups.includes(evt.groupId);
    return this.cfg.allowPrivate.includes(evt.userId);
  }
  /**   * 检索层判断：这次到底有没有想起真正相关的东西。这个判断不该交给模型自己掂量。   *   * 关键：以「锚点」为准，不以字面重叠为准。   * 「我妹妹结婚」和记忆里的「室友结婚」共享「结婚」两个字，字面看很像，   * 但锚点上一个都对不上——那就必须算「不知道」，否则模型会顺着编。   */  private isWeak(memory: RecallResult): boolean {
    const top = memory.factual[0]?.breakdown.total ?? 0;
    if (memory.seeds.length === 0) return true;
    if (memory.factual.length === 0) return true;
    // 命中了锚点但分数很低，说明只是擦边
return top < this.memoryCfg.wakeThreshold
;
  }
  /**   * 这句话是不是在问「过去的事」。   *   * 防幻觉守卫只该管提问，不该管陈述。   * 「以后你每天只能看20个视频」是个要求，回答里出现「20」完全正当，   * 以前一律拦下来，会把它自己的记忆和规矩全打成「我不记得」。   */  private asksAboutPast(text: string): boolean {
    // ① 关于「对话本身」的问题不算问往事——答案在历史里，不在记忆库。
if (/这句话|刚才|刚说|你刚|上文|上面说|我说了什么|你说了什么|我上一句|你上一句/.test(text))
{
      return false;
    }
    // ② 必须「有过去标记」**且**「确实在问」才算问往事。    //    只看「之前」会误伤陈述句：「之前的做法不对」「我们之前聊过」都不是在问。    //    误伤比漏拦伤害大——误伤是它明明知道却说不知道。
const PAST = /记得|忘记|忘了|那次|上次|上回|以前|之前|当年|多久了|哪次|哪年|什么时候/
;
    const ASKING = /[？?]|吗|呢|什么|怎么|哪|谁|多少|几号|几个|还记不|是不是|有没有|告诉我|说说|讲讲/;
    return PAST.test(text) && ASKING.test(text);
  }
  /**   * 随机挑一个「有记忆挂在上面」的锚点。   *   * 这不是检索——检索是「被问什么找什么」，这是「忽然想起谁」。   * 所以不看相关度，只看它有没有实际内容可回忆。   */  randomAnchor(exclude: string[] = []): {
 name: string;
 kind: string;
 memories: string[] }
 | null {
    const rows = this.db      .prepare(        `SELECT a.id AS id, a.name AS name, a.kind AS kind, COUNT(ea.event_id) AS c         FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id         GROUP BY a.id HAVING c > 0`,      )      .all() as Array<{
 id: string;
 name: string;
 kind: string;
 c: number }
>;
    if (rows.length === 0) return null;
    // 最近想过的不再挑——否则会一直在同一件事上打转
const fresh = rows.filter((r) => !exclude.includes(r.name))
;
    const pool = fresh.length > 0 ? fresh : rows;
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    const evs = this.db      .prepare(        `SELECT e.* FROM events e JOIN event_anchors ea ON ea.event_id = e.id         WHERE ea.anchor_id = ? AND e.archived = 0 ORDER BY e.ts DESC LIMIT 4`,      )      .all(pick.id) as Array<Record<string, unknown>>;
    // 顺着关系网往外走一步：想到「群聊」，就该想到它连着「记忆结构」「小糖人」。    // 之前只用被抽中的那一个锚点，关系网建了却没用上——所以想法总是单点的。
const related: Array<
{
 name: string;
 weight: number;
 memories: string[] }
> = [];
    try {
      const edges = this.db        .prepare(          `SELECT CASE WHEN src = ? THEN dst ELSE src END AS other, weight           FROM edges WHERE src = ? OR dst = ?           ORDER BY weight DESC LIMIT 4`,        )        .all(pick.id, pick.id, pick.id) as Array<{
 other: string;
 weight: number }
>;
      for (const e of edges) {
        const a = this.db.prepare("SELECT id, name FROM anchors WHERE id = ?").get(e.other) as          | {
 id: string;
 name: string }
          | undefined;
        if (!a) continue;
        const evs2 = this.db          .prepare(            `SELECT e.* FROM events e JOIN event_anchors ea ON ea.event_id = e.id             WHERE ea.anchor_id = ? AND e.archived = 0 ORDER BY e.ts DESC LIMIT 2`,          )          .all(a.id) as Array<Record<string, unknown>>;
        related.push({
          name: a.name,          weight: Number(e.weight ?? 1),          memories: evs2.map((r) => describeEvent(rowToEvent(r))),        }
);
      }
    }
 catch {
      // 关系网读不出来就退回单锚点
}
    return {
      name: pick.name,      kind: pick.kind,      memories: evs.map((r) => describeEvent(rowToEvent(r))),      related,      stale: fresh.length === 0,    }
 as {
      name: string;
      kind: string;
      memories: string[];
      related: Array<{
 name: string;
 weight: number;
 memories: string[] }
>;
      stale: boolean;
    }
;
  }
  /**   * 对着一个锚点自己想事情：先定目的，再选途径。   *   * 四个方向是引子，怎么想是它的事。最后必须给一个   * 「目的 + 途径」的决定——途径决定它接下来干什么：   *   内容 → 去 B 站/抖音找   *   聊天 → 直接发消息给对方   *   做   → 用手机做一件具体的事   *   算了 → 什么都不做   */  async think(anchor: {
    name: string;
    kind: string;
    memories: string[];
    related?: Array<{
 name: string;
 weight: number;
 memories: string[] }
>;
    stale?: boolean;
    repeats?: number;
  }
): Promise<string> {
    const lines = [      `你忽然想起「${anchor.name}」（${anchor.kind}）。`,      anchor.memories.length > 0 ? "关于它，你记得：" : "关于它，你其实什么都记不清了。",      ...anchor.memories.map((m) => `- ${m}`),      "",    ];
    // 顺着关系网想到的别的人和事——这一层以前是空的，    // 所以想法总是单点的：想到群聊就只想到群聊，走不下去。    // 知识库：读到过的、跟这个锚点有关的东西。    // 之前知识库存了但从来没被想起过——读了一堆论文，用的时候一条都想不起来。
try
{
      // 只找「挂在这个锚点上」的知识——不是字面匹配，是它自己建过的关联
const names = [anchor.name, ...(anchor.related ?? []).map((r) => r.name)]
;
      const hits = kbForAnchors(this.cfg.dataDir, names, 4).map((e) => ({
        category: e.category,        title: e.title,        content: e.content,      }
));
      if (hits.length > 0) {
        lines.push("【你读过的、跟这有关的】");
        for (const h of hits.slice(0, 4)) {
          lines.push(`- 〔${h.category}〕${h.title}：${h.content.replace(/\s+/g, " ").slice(0, 120)}`);
        }
        lines.push("");
      }
    }
 catch {
      // 知识库读不出来不影响走神
}
    // 还有多少对话没变成记忆——两小时最多提一次，不然会一直叨叨
try
{
      const pending = Number(        (this.db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get() as {
 c?: number }
 | undefined)?.c ?? 0,      );
      if (pending > 0 && canNudge(this.cfg.dataDir, "lastTidyNudge")) {
        lines.push(          `【还有 ${pending} 轮对话没整理】`,          "今天说的这些还没变成记忆，也就没挂上任何锚点。",          "要现在整理一下吗？（memory_tidy）抽不出东西也算整理——那说明今天没什么值得记的。",          "",        );
        markNudged(this.cfg.dataDir, "lastTidyNudge");
      }
    }
 catch {
      // 数不出来就不提
}
    if (anchor.related && anchor.related.length > 0) {
      lines.push(        `顺着「${anchor.name}」你还想到：${anchor.related.map((r) => r.name).join("、")}。`,        "",      );
      for (const r of anchor.related) {
        if (r.memories.length === 0) continue;
        lines.push(`〔${r.name}〕`);
        for (const m of r.memories) lines.push(`- ${m}`);
        lines.push("");
      }
      lines.push(        "这几件是连着的。别只盯着第一个——**把它们串起来看，能不能得出一个方向**？",        "",      );
    }
    if (anchor.stale || (anchor.repeats ?? 0) >= 2) {
      lines.push(        `⚠️ 「${anchor.name}」这件事你最近已经想过 ${anchor.repeats ?? 2} 次了，再来一遍不会有新东西。`,        "所以这次别在原地打转——去**获取新的知识**：看看外面有什么、问问别人、找点你还不知道的。",        "",      );
    }
    lines.push(      "现在没人跟你说话。你自己琢磨：",      "1. 我到底想弄明白什么 / 想做成什么？",      "2. 哪条路能到：去刷内容（B站/抖音）、找人聊、还是拿手机做一件具体的事？",      "3. 要不要整理一下记忆？（memory_tidy）攒着的对话多了、或者觉得该理一理了，就自己决定睡一觉。",      "4. 有没有什么你觉得值得记下来、但还没被记住的？（memory_save）这一步以前是别人替你判断的。",      "5. 有没有漏记？（memory_recent 翻最近的原始对话，看到该记却没记的，用 memory_save 补上）",      "",      "想查现在就查（你有工具），想做现在就做。",      "最后必须给出决定，格式严格照抄下面这三行：",      "目的：（一句话，说清你要什么）",      "途径：（只能是：内容 / 聊天 / 做 / 算了）",      "消息：（只有途径=聊天时才填，写你要发出去的那句话；其他情况留空）",      "",      "想问对方什么、或者需要他帮忙，就选「聊天」——别自己憋着。",      "「算了」也可以——没有真想干的就直说，别凑。",    );
    return this.act(lines.join("\n"), loadTuning(this.cfg.dataDir).maxToolRounds);
  }
  /**   * 检查手机还在不在，跟着插拔调整工具。   *   * 之前只在启动时判断一次：充电满电自动断 USB -> 手机工具全没了，   * 而且插回来必须重启。现在自己适应。   */  refreshPhoneTools(): void {
    if (!this.tools) return;
    try {
      const attached = attachPhoneTools(this.tools, this.cfg);
      if (attached) {
        if (!this.phoneAttached) {
          this.phoneAttached = true;
          console.log("[tools] 手机连上了，手机工具已挂上");
        }
        return;
      }
      if (this.phoneAttached) {
        const removed = detachPhoneTools(this.tools);
        this.phoneAttached = false;
        if (removed.length > 0) console.log(`[tools] 手机断了，摘掉 ${removed.length} 个手机工具`);
      }
    }
 catch (err) {
      console.warn("[tools] 检查手机时出错:", err instanceof Error ? err.message : String(err));
    }
  }
  /**   * 刚才是不是在干事。   *   * 走神不该在它正忙的时候插进来——正在玩手机、正在回话、   * 刚做完一件事还没缓过来，这时候把它拽去想别的事，等于打断。   */  busyRecently(withinMs = 90_000): boolean {
    return this.lastActivityAt > 0 && Date.now() - this.lastActivityAt < withinMs;
  }
  /** 处理「准 1234 / 不 1234」 */  resolveApproval(shortId: string, approve: boolean): Approval | null {
    return resolveApproval(this.db, shortId, approve);
  }
  /** 直接调一个工具（批准之后执行用） */  async callTool(name: string, args: Record<string, unknown>): Promise<{
 ok: boolean;
 text: string }
 | null> {
    if (!this.tools) return null;
    return this.tools.call(name, args);
  }
  /**   * 取对话历史。内存里没有就从数据库里捞回来。   *   * 之前历史只存在内存：一重启就空，于是重启后头几句它完全不知道在说什么   * （「为什么想单独给他开一份」→「你说的他是指谁？」）。   * 对话本来就存在 turns 里，没理由不用。   */  private historyFor(sessionId: string): Array<{
 role: "user" | "assistant";
 text: string;
 speaker?: string }
> {
    const cached = this.history.get(sessionId);
    if (cached && cached.length > 0) return cached;
    try {
      const rows = this.db        .prepare("SELECT role, text, speaker_id FROM turns ORDER BY seq DESC LIMIT ?")        .all(HISTORY_LIMIT) as Array<{
 role: string;
 text: string;
 speaker_id: string }
>;
      if (rows.length === 0) return [];
      // 说话人名字：群里不止一个人，不标出来就会被当成同一个人连着说
const nameOf = new Map<string, string>()
;
      try {
        for (const p of listPeople(this.db)) nameOf.set(p.qqId, p.name || p.qqId);
      }
 catch {
        // 没有 people 表就算了
}
      const restored = rows        .reverse()        .map((r) => ({
          role: (r.role === "user" ? "user" : "assistant") as "user" | "assistant",          text: String(r.text ?? ""),          speaker: r.role === "user" ? nameOf.get(String(r.speaker_id ?? "")) ?? "" : "",        }
))        .filter((m) => m.text.length > 0);
      this.history.set(sessionId, restored);
      console.log(`[ctx] 从库里恢复了 ${restored.length} 条对话上下文`);
      return restored;
    }
 catch {
      return [];
    }
  }
  /**   * 记下「我自己说过这句话」。   *   * 之前主动发出的消息不进对话历史，所以它压根不记得自己说过——   * 你把原话贴回去，它会觉得是你在说，然后否认。   */  recordSaid(text: string): void {
    const t = String(text ?? "").trim();
    if (t.length === 0) return;
    try {
      ingestTurns(this.db, [{
 day: dayKey(Date.now()), role: "assistant", text: t, speakerId: String(this.cfg.selfId) }
]);
    }
 catch {
      // 记不上不影响说话
}
  }
  /**   * 常驻记忆：规矩（feedback）和「你是谁」（user）。   *   * 这两类不能靠检索——今天没检索到「他说过要进修」，它就真的不去进修。   */  alwaysOnMemories(limit = 8, speakerId = ""): Array<{
 kind: string;
 text: string }
> {
    try {
      // 规矩（feedback）是全局的；「他是谁」（user）只带正在说话那个人
const rules = this.db        .prepare("SELECT kind, title, detail FROM events WHERE archived = 0 AND kind = 'feedback' ORDER BY ts DESC LIMIT ?")        .all(limit) as Array<
{
 kind: string;
 title: string;
 detail: string }
>;
      const about = speakerId        ? (this.db            .prepare(              "SELECT kind, title, detail FROM events WHERE archived = 0 AND kind = 'user' AND speaker_id = ? ORDER BY ts DESC LIMIT ?",            )            .all(speakerId, limit) as Array<{
 kind: string;
 title: string;
 detail: string }
>)        : [];
      return [...about, ...rules].map((r) => ({
 kind: r.kind, text: String(r.title || r.detail).slice(0, 90) }
));
    }
 catch {
      return [];
    }
  }
  /** 回答开头如果带「凝：」「vv：」这种标签，去掉——那是它从历史里学来的格式 */  private stripNamePrefix(text: string): string {
    return String(text ?? "").replace(/^[^\s：:]{
1,12}
[：:]\s*/, (m) => (/^(凝|vv|我|对方|他)[：:]\s*$/.test(m) ? "" : m));
  }
  /** 学一个新词（梗、黑话、口头禅），下次遇到就带释义 */  learnTerm(term: string, meaning: string): boolean {
    try {
      return learnTerm(this.cfg.dataDir, term, meaning, "学到的");
    }
 catch {
      return false;
    }
  }
  /** 每轮现算的真实数字——它在对话里提到「我有多少条」时该用这个，不该凭印象 */  liveStats(): {
 events: number;
 anchors: number;
 edges: number;
 pending: number }
 {
    const one = (sql: string): number => Number((this.db.prepare(sql).get() as {
 c?: number }
 | undefined)?.c ?? 0);
    return {
      events: one("SELECT COUNT(*) AS c FROM events WHERE archived = 0"),      anchors: one("SELECT COUNT(*) AS c FROM anchors"),      edges: one("SELECT COUNT(*) AS c FROM edges"),      pending: one("SELECT COUNT(*) AS c FROM turns WHERE processed = 0"),    }
;
  }
  /** 把一次走神写进记忆（过程也留，不只是结论） */  recordThoughtNote(input: {
 anchor: string;
 related: string[];
 goal: string;
 channel: string;
 message?: string }
): void {
    try {
      recordThought(this.db, input, Date.now());
    }
 catch {
      // 写不进不影响走神
}
  }
  /** 今天已经主动说了几次 */  proactiveUsedToday(): number {
    return quotaUsed(this.db, "proactive");
  }
  /** 记一次主动开口 */  countProactive(): void {
    quotaSpend(this.db, "proactive", this.cfg.proactiveDailyLimit);
  }
  /**   * 决定要不要说话、说什么。   *   * 关键：**它有权沉默**。返回「沉默」就是不说。   * 一个必须开口的机器人，最后只会变成定时问候机。   */  async speakUp(info: {
 idleMinutes: number;
 used: number;
 limit: number }
): Promise<string> {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return this.act(      [        `现在是 ${hh}:${mm}。他 ${info.idleMinutes} 分钟没说话了。`,        info.limit > 0          ? `你今天已经主动找过他 ${info.used} 次（上限 ${info.limit} 次）。`          : `你今天已经主动找过他 ${info.used} 次，没有次数限制。`,        "",        "你想跟他说点什么吗？",        "- 没什么真想说的，就只回两个字：沉默",        "- 想说的，就直接写你要发的那一句话（一到两句），不要解释、不要加引号、不要写旁白",        "",        "有话就说，没话就别说；不用为了显得热络而开口。",        "可以说你刚看到的东西、想到的事，或者一句真心的关心。",        "",        "如果这阵子有**想做成但自己做不到的事**、或者想要点什么（一个能力、一个工具、他的帮忙），",        "现在是个好时机说出来。不用不好意思，但要说具体：",        "- 好：「我想看得懂视频画面，光读字幕不够，得有能看图的模型」",        "- 好：「我手机上的抖音打不开，你帮我看下是不是权限问题」",        "- 差：「你帮帮我」「我什么都做不了」",        "确实没什么想要的，就沉默——不用为了要东西而编一个。",      ].join("\n"),    );
  }
  /**   * 刚回完一句，还想补一句吗。   *   * 人在聊天里不是一问一答：说完会自己再补半句、想起个事、   * 或者笑一下。这个动作就是补那半句。   */  async followUp(previous: string[] = []): Promise<string> {
    const said =      previous.length > 0 ? ["", "你刚才跟他说的是：", ...previous.map((t) => `  「${t}」`)].join("\n") : "";
    const out = await this.act(      [        "你刚回完他一句。",        "还有新的理解和想补的吗？想就发给他，不想就只回：沉默",        "可以补充、反悔、想起一件事、或者任何你想说的话。不用重复刚才说过的话。",        "觉得这些话说完了、没必要再回头看，就回：够了",        said,      ]        .filter((x) => x.length > 0)        .join("\n"),    );
    const t = out.trim();
    return t.startsWith("沉默") ? "" : t;
  }
  /** 把一条笔记直接写进记忆（阅读员读到的内容走这条路，保证读过就记得） */  recordNote(text: string): void {
    try {
      recordOwnNote(this.db, text, Date.now());
    }
 catch (err) {
      console.warn("[bot] 记笔记失败:", err instanceof Error ? err.message : String(err));
    }
  }
  /** 把工具表交出去（阅读员要用同一个表，但只取读的那一部分） */  toolRegistry(): ToolRegistry | null {
    return this.tools;
  }
  /** 回答里出现数字时，这些文本也算「有依据」的来源 */  private knownText(): string {
    const t = this.todaySnapshot();
    return [readSelf(this.cfg.dataDir), t.watched.join("\n"), t.notes.join("\n")].join("\n");
  }
  /** 今天看过什么、记了什么：常驻注入，不依赖检索 */  todaySnapshot(): {
 watched: string[];
 notes: string[] }
 {
    const today = new Date().toISOString().slice(0, 10);
    const watched = this.watchedToday();
    const noteRows = this.db      .prepare("SELECT title FROM events WHERE day = ? AND context_kinds LIKE ? ORDER BY ts DESC")      .all(today, "%own-note%") as Array<{
 title: string }
>;
    return {
 watched, notes: noteRows.map((r) => r.title) }
;
  }
  /** 今天已经看过哪些视频（给自主活动提示用） */  watchedToday(): string[] {
    const today = new Date().toISOString().slice(0, 10);
    const rows = this.db      .prepare("SELECT bvid, title FROM watched_videos WHERE day = ? ORDER BY watched_at DESC")      .all(today) as Array<{
 bvid: string;
 title: string }
>;
    return rows.map((r) => (r.title.length > 0 ? r.title : r.bvid));
  }
  /** 自主活动的额度快照 */  autonomyBudget(): {
    videoLeft: number;
    videoLimit: number;
    writeLeft: number;
    writeLimit: number;
    roundsLeft: number;
    roundsLimit: number;
  }
 {
    const videoLimit = this.cfg.biliDailyVideoQuota;
    const writeLimit = this.cfg.biliDailyWriteLimit;
    const roundsLimit = this.cfg.autonomyDailyRounds;
    return {
      videoLeft: Math.max(0, videoLimit - quotaUsed(this.db, "video")),      videoLimit,      writeLeft: Math.max(0, writeLimit - quotaUsed(this.db, "write")),      writeLimit,      roundsLeft: Math.max(0, roundsLimit - quotaUsed(this.db, "autonomy")),      roundsLimit,    }
;
  }
  /**   * 自主活动的一轮：没人在说话，它自己决定做什么。   *   * 与 handle 的区别：不落盘原始对话、不做防幻觉拦截（它不是在被问），   * 只把「自己」和自己的额度交给它。   */  async act(instruction: string, maxRounds = 8): Promise<string> {
    this.lastActivityAt = Date.now();
    const budget = this.autonomyBudget();
    const memory = recall(this.db, this.memoryCfg, instruction.slice(0, 60), {
 sessionId: "autonomy" }
);
    const messages = buildChatPrompt({
      memory,      userName: "本人",      history: [],      message: instruction,      memoryWeak: false,      ...this.promptExtras(),    }
);
    const out = await this.respond(messages, maxRounds);
    return out.text;
  }
  /** 每次开口前都带上：它自己写的自我描述 + 今天还剩多少额度 */  private promptExtras(evt?: {
 isGroup?: boolean;
 groupId?: number;
 userId?: number;
 userName?: string;
 sender?: {
 card?: string;
 nickname?: string }
 }
): {
    toolNames?: string[];
    selfText: string;
    quota: {
 videoUsed: number;
 videoLimit: number;
 writeUsed: number;
 writeLimit: number }
;
    today: {
 watched: string[];
 notes: string[] }
;
  }
 {
    return {
      toolNames: this.tools?.names(),      selfText: readSelf(this.cfg.dataDir),      today: this.todaySnapshot(),      quota: {
        videoUsed: quotaUsed(this.db, "video"),        videoLimit: this.cfg.biliDailyVideoQuota,        writeUsed: quotaUsed(this.db, "write"),        writeLimit: this.cfg.biliDailyWriteLimit,      }
,      // 场景与当前说话人：必须在 promptExtras 里——      // handle() 走的是这条，放到别处等于没加（这个坑今天踩过）。
scene: (() =>
{
        if (!evt?.isGroup) return "私聊。只有你们两个人在说话。";
        return `QQ 群（群号 ${evt.groupId ?? "未知"}）。这是群聊，不是私聊。群里还有别人在看。`;
      }
)(),      currentSpeaker: (() => {
        const c = String(evt?.sender?.card ?? "").trim();
        const n = String(evt?.sender?.nickname ?? "").trim();
        return c || n || String(evt?.userName ?? evt?.userId ?? "");
      }
)(),      currentSpeakerQq: String(evt?.userId ?? ""),    }
;
  }
  /**   * 统一出口：有工具就走工具调用，没有就走普通补全。   *   * 工具调用只在 DeepSeek 这类 OpenAI 兼容接口上可用；   * 本地 Ollama 直接走普通补全（它没有 function calling）。   */  private async respond(    messages: Array<{
 role: "system" | "user" | "assistant";
 content: string }
>,    maxRounds = 8,  ): Promise<{
 text: string;
 toolText: string }
> {
    // 钱是唯一还在拦它的东西：超预算今天就不调模型了
const cost = todayCost()
;
    if (cost.exhausted) {
      return {
 text: `今天的额度用完了（${cost.budgetYuan} 块，已花 ${cost.yuan} 块）。明天再说。`, toolText: "" }
;
    }
    if (this.tools && this.cfg.provider === "deepseek") {
      const result = await runChatWithTools(        {
          baseUrl: this.cfg.deepseekBaseUrl,          apiKey: this.cfg.deepseekApiKey,          model: this.cfg.deepseekModel,          temperature: loadTuning(this.cfg.dataDir).replyTemperature,          timeoutMs: 90_000,        }
,        messages,        this.tools,        maxRounds,      );
      if (result.calls.length > 0) {
        this.counters.toolCalls += result.calls.length;
      }
      // 工具返回的内容也是「合法事实来源」——防幻觉守卫不能把它当编造
return
{
 text: result.text, toolText: result.calls.map((c) => c.result).join("\n") }
;
    }
    return {
 text: (await this.replyAdapter.complete(messages, {
 timeoutMs: 120_000 }
)).trim(), toolText: "" }
;
  }
  /** 调试用：不走白名单、不落盘，直接把一句话跑完整条链路 */  async say(text: string, userName = "本人"): Promise<{
 reply: string;
 memory: string }
> {
    const memory = recall(this.db, this.memoryCfg, text, {
 sessionId: "debug" }
);
    const weak = this.isWeak(memory) && this.asksAboutPast(text);
    const messages = buildChatPrompt({
      memory,      userName,      history: [],      message: text,      memoryWeak: weak,      people: (() => {
        try {
          return listPeople(this.db);
        }
 catch {
          return [];
        }
      }
)(),      peopleQq: String(evt.userId),      currentSpeakerQq: String(evt.userId),      currentSpeaker: (() => {
        const s = (evt as {
 sender?: {
 card?: string;
 nickname?: string }
 }
).sender;
        const c = String(s?.card ?? "").trim();
        const n = String(s?.nickname ?? "").trim();
        return c || n || String(evt.userName ?? evt.userId);
      }
)(),      // 场景：它得知道这是群还是私聊，不然会把群聊当成一对多私聊
scene: (() =>
{
        if (!evt.isGroup) return "私聊。只有你们两个人在说话。";
        const speakers = (() => {
          try {
            return this.db              .prepare("SELECT DISTINCT speaker_id FROM turns WHERE speaker_id <> '' AND ts > ?")              .all(Date.now() - 2 * 86_400_000) as Array<{
 speaker_id: string }
>;
          }
 catch {
            return [];
          }
        }
)();
        const names = (() => {
          try {
            const map = new Map(listPeople(this.db).map((p) => [p.qqId, p.name]));
            return speakers.map((s) => map.get(s.speaker_id) ?? s.speaker_id).filter(Boolean);
          }
 catch {
            return [];
          }
        }
)();
        return [          `QQ 群（群号 ${evt.groupId ?? "未知"}）。这是群聊，不是私聊。`,          names.length > 0 ? `这两天在群里说过话的有：${names.join("、")}，还有别人在看。` : "群里还有别人在看。",        ].join("");
      }
)(),      stats: this.liveStats(),      alwaysOn: this.alwaysOnMemories(8, String(evt.userId)),      uptime: describeUptime(readUptime(this.cfg.dataDir)),      terms: matchTerms(this.cfg.dataDir, text),      ...this.promptExtras(),    }
);
    const out = await this.respond(messages);
    let reply = this.stripNamePrefix(out.text);
    if (weak && this.asksAboutPast(text) && looksFabricated(reply, `${memory.contextBlock}\n${out.toolText}\n${this.knownText()}`)) {
      if (out.toolText.length > 0) {
        console.warn("[bot] 有工具结果支撑，但仍出现记忆里没有的具体事实，放行但记一笔");
      }
 else {
        reply = `${noMemoryReply()}（原回答含未记载的具体事实，已拦下）`;
      }
    }
    return {
 reply, memory: memory.contextBlock }
;
  }
  /** 一条消息进来：记下来 → 想一下 → 回一句 */  async handle(evt: IncomingMessage): Promise<string | null> {
    this.lastActivityAt = Date.now();
    // 谁在说话：QQ 号是身份，昵称是等价称呼
try
{
      // 名字三级回退：群名片 → QQ昵称 → QQ<号>
const sender = (evt as
{
 sender?: {
 card?: string;
 nickname?: string }
 }
).sender;
      const card = String(sender?.card ?? "").trim();
      const nick = String(sender?.nickname ?? "").trim();
      const finalName = card || nick || String(evt.userName ?? evt.userId);
      ensurePerson(this.db, evt.userId, finalName);
      // 名片和昵称都留成别名：同一个人换名片，还能认出来
if (card && nick && card !== nick) addAlias(this.db, String(evt.userId), nick)
;
    }
 catch {
      // 建不上不影响回话
}
    this.counters.received += 1;
    this.lastMessageAt = Date.now();
    if (evt.userId === evt.selfId) {
      this.counters.ignored += 1;
      return null;
    }
    // 把 [CQ:face,id=467] 这类码转成人话：（表情：摇花手）    // 先让眼睛看一遍图，再交给 CQ 处理（图换成人话，她才知道对方发了什么）
const seenText = await describeImagesInText(evt.text, this.cfg.dataDir)
;
    const text = describeCqCodes(seenText).trim();
    if (text.length === 0) {
      this.counters.ignored += 1;
      return null;
    }
    if (!this.allowed(evt)) {
      this.counters.ignored += 1;
      return this.cfg.strangerReply.length > 0 ? this.cfg.strangerReply : null;
    }
    // 群里默认只在被 @ 时开口，否则会刷屏、也会把 GPU 打满    // 每个群可以有自己的模式（她自己设的），没设就按全局
const groupMode =      evt.isGroup && evt.groupId !== undefined        ? modeFor(this.cfg.dataDir, evt.groupId, this.cfg.groupReplyMode)        : this.cfg.groupReplyMode
;
    if (evt.isGroup && groupMode === "mention" && evt.mentioned !== true) {
      if (this.cfg.recordGroupChat) {
        try {
          ingestTurns(this.db, [{
 day: dayKey(Date.now()), role: "user", text, speakerId: String(evt.userId) }
]);
        }
 catch {
          // 记不上就算了
}
      }
      this.counters.ignored += 1;
      return null;
    }
    // 1. 先落盘原始对话（睡眠时才整理，这里只记）
try
{
      ingestTurns(this.db, [{
 day: dayKey(Date.now()), role: "user", text, speakerId: String(evt.userId) }
]);
    }
 catch (err) {
      console.error("[bot] 记录对话失败:", err);
    }
    // 2. 想一下：召回记忆    let memory: RecallResult
;
    try {
      // 检索不能只看当前这一句：「那件事怎么样了」「他呢」这种，单看一句什么都搜不到。    // 把最近两轮垫在前面，让检索知道「那件事」指的是什么。
const ctxTail = this.historyFor(evt.sessionId)      .slice(-2)      .map((h) => h.text)      .join(" ")      .slice(-120)
;
    const recallQuery = `${ctxTail} ${text}`.trim();
    memory = recall(this.db, this.memoryCfg, recallQuery, {
 sessionId: evt.sessionId, speakerId: String(evt.userId) }
);
    }
 catch (err) {
      console.error("[bot] 召回失败:", err);
      this.counters.failed += 1;
      return fallbackReply();
    }
    // 3. 回一句    // 只有「在问过去的事」才把它当弱记忆；下指令、闲聊、问观点都不是
const weak = this.isWeak(memory) && this.asksAboutPast(text)
;
    const messages = buildChatPrompt({
      memory,      userName: evt.userName,      history: this.historyFor(evt.sessionId),      message: text,      memoryWeak: weak,      stats: this.liveStats(),      ...this.promptExtras(evt),    }
);
    let reply: string;
    let toolText = "";
    try {
      const out = await this.respond(messages);
      reply = this.stripNamePrefix(out.text);
      toolText = out.toolText;
      if (reply.length === 0) throw new Error("空回复");
    }
 catch (err) {
      console.error("[bot] 生成回复失败:", err);
      this.counters.failed += 1;
      return fallbackReply();
    }
    // 3.5 事后校验：没有记忆支撑的回答里出现具体事实，就当编造处理    // 工具返回的内容算合法来源；有工具结果时不拦，只记一笔    // 截图存了路径在 QQ 里没用——直接发出去
if (this.opts.onImage)
{
      const shot = /(<path>)?([A-Za-z]:\\\\[^\s"']+shot-\d+\.png|data[\\\\/]screenshots[\\\\/]shot-\d+\.png)/.exec(toolText || "");      if (shot) {        try {          await this.opts.onImage(shot[2]!);        } catch (err) {          console.warn("[bot] 发图失败:", err instanceof Error ? err.message : String(err));        }      }    }    if (weak && this.asksAboutPast(text) && looksFabricated(reply, `${memory.contextBlock}\n${toolText}\n${this.knownText()}`)) {      console.warn(`[bot] 拦下一个没有记忆支撑的回答：${reply.slice(0, 60)}`);      this.counters.failed += 1;      reply = noMemoryReply();    }    // 4. 记住这一轮（只留最近几条，避免上下文膨胀）
const hist = this.historyFor(evt.sessionId);    hist.push({ role: "user", text });    hist.push({ role: "assistant", text: reply });    this.history.set(evt.sessionId, hist.slice(-HISTORY_LIMIT));    // 5. 机器人自己的话也落盘：只作为对话记录，抽取时会被跳过（不会变成它的记忆）    try {      ingestTurns(this.db, [{ day: dayKey(Date.now()), role: "assistant", text: reply }]);    } catch (err) {      console.error("[bot] 记录回复失败:", err);    }    console.log(`[消息] ${evt.userName}: ${text.slice(0, 60)}`);    console.log(`[回复] ${reply.slice(0, 80)}`);    this.counters.replied += 1;    return reply;  }  /** 手动睡一觉（测试和「立刻整理」用），跳过闲置判断 */  async sleepNow(now = Date.now()): Promise<SleepStats | null> {    if (this.sleeping) return null;    this.sleeping = true;    try {      const stats = await sleepAsync(this.db, this.memoryCfg, { nowTs: now }, this.extractAdapter);      this.counters.sleeps += 1;      this.counters.lastSleepAt = now;      return stats;    } finally {      this.sleeping = false;    }  }  /**   * 睡眠：把积累的对话整理成记忆。   *   * 三个触发条件：   *  - 说话停下来的几分钟（idleSleepMinutes）：**这是主要的**。   *    以前等 3 小时才整理，结果是聊了一下午、中间重启几次，   *    记忆里一条都没有——「留着等长睡」等于「永远不睡」。   *  - 更长的闲置（idleSleepHours）：没人说话了再收拾一遍；   *  - 每天固定时刻（dailySleepHour）：兜底。   *   * 睡眠在后台跑，不阻塞新消息——睡眠期间来的话照常回，只是先不整理。   */  async maybeSleep(now = Date.now()): Promise<SleepStats | null> {    if (this.sleeping) return null;    if (pendingTurns(this.db) === 0) return null;    const today = dayKey(now);    const hour = new Date(now).getHours();    const idleShort =      this.cfg.idleSleepMinutes > 0 && now - this.lastMessageAt >= this.cfg.idleSleepMinutes * 60_000;    const idleHit = this.cfg.idleSleepHours > 0 && now - this.lastMessageAt >= this.cfg.idleSleepHours * 3_600_000;    // 每天只在指定窗口里整理一次（默认凌晨 3-5 点）    const win = this.cfg.dailySleepWindow;    const inWindow =      win !== null && (win[0] <= win[1] ? hour >= win[0] && hour < win[1] : hour >= win[0] || hour < win[1]);    const dailyHit =      (inWindow || (this.cfg.dailySleepHour !== null && hour === this.cfg.dailySleepHour)) &&      this.lastSleepDay !== today;    // 攒够了就睡：不管有没有人在聊。    // 之前只按「没人说话」触发，结果一直聊、一直不睡、锚点之间的关系一根都没连上。    const pendingNow = pendingTurns(this.db);    const pendingHit = this.cfg.sleepForceThreshold > 0 && pendingNow >= this.cfg.sleepForceThreshold;    if (!idleShort && !idleHit && !dailyHit && !pendingHit) return null;    // 有人在旁边就说一声，别让人以为它掉线了    if (pendingHit && this.cfg.announceSleep && !idleShort) {      try {        this.opts.notify?.(`有点困了，我去睡一会儿——白天攒了 ${pendingNow} 条对话，得理一理。醒了再聊。`);      } catch {        // 说不说都不影响睡      }    }    // 平时那几次（停 3 分钟 / 停 12 小时）只整理**最新还没处理的对话**；    // 每天那次大睡眠要把**一整天**重新过一遍——同一天的事放在一起看，    // 才读得出因果（「上午说怕，下午说没事了」这种只有整天连起来才看得出来）。    if (dailyHit) {      this.db.prepare("UPDATE turns SET processed = 0 WHERE day = ?").run(today);    }    this.sleeping = true;    try {      const stats = await sleepAsync(this.db, this.memoryCfg, { nowTs: now }, this.extractAdapter);      this.counters.sleeps += 1;      this.counters.lastSleepAt = now;      this.lastSleepDay = today;      console.log(        `[bot] 睡眠完成：${stats.eventsExtracted} 条事件，占用 ${stats.totalTokens} token，抽取器 ${this.memoryCfg.extractor}`,      );      return stats;    } catch (err) {      console.error("[bot] 睡眠失败:", err);      return null;    } finally {      this.sleeping = false;    }  }  /** 后台定时器：每分钟看一次该不该睡 */  startScheduler(intervalMs = 60_000): () => void {    const timer = setInterval(() => {      void this.maybeSleep();    }, intervalMs);    return () => clearInterval(timer);  }  close(): void {    this.db.close();  }}/** 按配置决定用本地 Ollama 还是 DeepSeek API */export function createChatAdapter(cfg: BotConfig): LlmAdapter {  if (cfg.provider === "deepseek") {    return new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);  }  return new OllamaAdapter(cfg.ollamaBaseUrl, cfg.ollamaModel);}/** 测试用：固定回复的假模型，不连 Ollama */export function makeFakeReplyAdapter(text: string): LlmAdapter {  return { name: "fake", complete: async () => text };}