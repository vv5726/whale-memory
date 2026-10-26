import type {
 DatabaseSync } from "node:sqlite";
import { resolveSaidBy } from "../learn-person.ts";
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
import {
 addAlias, ensurePerson, listPeople, resolvePerson } from "../people.ts";
import {
 describeCqCodes } from "../cqcode.ts";
import {
 describeImagesInText } from "../vision.ts";
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
export interface IncomingMessage {
  /** �Ự��ʶ��˽�� private:uid��Ⱥ�� group:gid:user:uid */  sessionId: string;
  userId: number;
  userName: string;
  text: string;
  isGroup: boolean;
  groupId?: number;
  /** Ⱥ���Ƿ� @ �˻����� */  mentioned?: boolean;
  /** �������Լ��� QQ �� */  selfId: number;
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
/** * QQ �����˵ĺ����߼����ʹ�����޹ء� * * ����㣨OneBot WebSocket��ֻ���շ������С�������ô�á����ж϶������ * ������������ QQ Ҳ�ܰ�������·��ͨ�� */export class BotService {
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
  private lastSleepDay = "";
  private tools: ToolRegistry | null;
  private opts: {
 onImage?: (filePath: string) => void | Promise<void>;
 notify?: (text: string) => void };
  private sleeping = false;
  private counters = {
    received: 0,    replied: 0,    ignored: 0,    failed: 0,    sleeps: 0,    toolCalls: 0,    lastSleepAt: null as number | null,  };
  constructor(    cfg: BotConfig,    opts: {
      replyAdapter?: LlmAdapter;
      extractAdapter?: LlmAdapter;
      db?: DatabaseSync;
      /** ���߲�����ͼƬ�ļ�ʱ��������ͼ����ȥ��qq-bridge ��ý��ܵ������ǲ��ϣ� */      onImage?: (filePath: string) => void | Promise<void>;
      /** ������˵һ�仰ʱ������˯��ǰ���к�����ʾ�ȣ� */      notify?: (text: string) => void;
    } = {
},  ) {
    this.opts = opts;
    this.cfg = cfg;
    this.memoryCfg = withOverrides(DEFAULT_CONFIG, {
      contextBudgetTokens: cfg.contextBudgetTokens,      extractor: cfg.useLlmExtractor ? "llm" : "heuristic",      llmBaseUrl: cfg.ollamaBaseUrl,      llmModel: cfg.ollamaModel,    });
    this.db = opts.db ?? openDb(cfg.memoryDb);
    // ������ҵ��������ʾê�㣺��ʵʹ�õ�ê��Ӧ�ôӶԻ����Լ���������    // ��Ҫ������ê��Ļ������������� seedAnchorsFile��
    this.replyAdapter = opts.replyAdapter ?? createChatAdapter(cfg);
    this.tools = cfg.toolsEnabled      ? buildTools(cfg, this.db, opts.notify, {
          // ���Լ��ж�ĳ����ֵ�üǣ���ֱ�Ӵ�
          save: (text) => {
            try {
              recordOwnNote(this.db, text, Date.now());
              return {
 ok: true, text: `�����ˣ�${text.slice(0, 30)}` };
            } catch (err) {
              return {
 ok: false, text: `�治����${err instanceof Error ? err.message : String(err)}` };
            }          },          // ���Լ�������һ�Σ�����˯һ����
          db: this.db,          countLive: () => Number(this.db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0),          snapshot: (rows) => {
            try {
              const line = rows.map((r) => JSON.stringify({
 at: Date.now(), id: r.id, title: r.title, detail: r.detail })).join("\n");
              (globalThis as {
 __forgotten?: string[] }).__forgotten?.push(line);
            } catch {
              // �治�������ˣ�������Ϊ����ʧ�ܶ���ɾ
            }          },          getTuning: () => loadTuning(this.cfg.dataDir),          setTuning: (t) => saveTuning(this.cfg.dataDir, t),          pin: (input) => pinMemory(this.db, input),          why: (query) => {
            const r = recall(this.db, this.memoryCfg, query || "�������", {
 sessionId: "why" });
            return r.scored ?? [];
          },          about: (input) => aboutPerson(this.db, input),          listMemories: (opts) => listMemories(this.db, opts),          settle: (threshold) => settleByScore(this.db, threshold),          mentorAsk: (question, context) => {
            askMentor(this.cfg.dataDir, question, context ?? "");
            return {
 ok: true, text: "���������ˡ����ȸɱ�ģ��ظ�����֮��ĶԻ�����֡�" };
          },          mentorReplies: () => takeReplies(this.cfg.dataDir).map((r) => ({
 answer: r.answer })),          kbAdd: ({
 category, title, content, source, anchors }) => {
            const known = (this.db.prepare("SELECT name FROM anchors").all() as Array<{
 name: string }>).map((r) => r.name);
            const e = addKnowledge(this.cfg.dataDir, {
 category, title, content, source, anchors, knownAnchors: known });
            return {
 ok: true, text: `�ս���${e.category}����${e.title}` };
          },          kbSearch: (query) => searchKnowledge(this.cfg.dataDir, query).map((e) => ({
 category: e.category, title: e.title, content: e.content, source: e.source })),          kbList: () => listCategories(this.cfg.dataDir),          kbLink: (title, anchor, remove) => linkKnowledge(this.cfg.dataDir, title, anchor, remove),          learn: (term, meaning, saidBy) => { const person = resolveSaidBy(this.db, saidBy); return person ? learnTerm(this.cfg.dataDir, term, meaning, person.name, person) : false; },          lookup: (term) => matchTerms(this.cfg.dataDir, term).find((t) => t.term === term)?.meaning,          tidy: async () => {
            const stats = await this.sleepNow();
            if (!stats) return {
 ok: false, text: "�ո��������ˣ�����û�д������Ķ���" };
            const total = Number(this.db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
            return {
 ok: true, text: `�������ˣ���γ鵽 ${stats.llm?.inserted ?? 0} ���������ܹ� ${total} ������` };
          },        })      : null;
    initCost(this.db, {
      inputPerMTok: cfg.costInputPerMTok,      outputPerMTok: cfg.costOutputPerMTok,      dailyBudgetYuan: cfg.dailyBudgetYuan,    });
    // ��ȡҲ��ͬһ����ˣ�API ģ�͵ĳ�ȡ�������Ը��ڱ��� 8b
    // v3 开关必须显式带进抽取层：memoryCfg 是另一个对象，withOverrides 不会传过去
    (this.memoryCfg as { extractV3?: boolean }).extractV3 = (cfg as { extractV3?: boolean }).extractV3 === true;
    this.extractAdapter = opts.extractAdapter ?? (cfg.provider === "deepseek" ? this.replyAdapter : undefined);
  }  stats(): BotStats {
    return {
 ...this.counters, pendingTurns: pendingTurns(this.db) };
  }  private allowed(evt: IncomingMessage): boolean {
    if (evt.isGroup) return evt.groupId !== undefined && this.cfg.allowGroups.includes(evt.groupId);
    return this.cfg.allowPrivate.includes(evt.userId);
  }  /**   * �������жϣ���ε�����û������������صĶ���������жϲ��ý���ģ���Լ�������   *   * �ؼ����ԡ�ê�㡹Ϊ׼�����������ص�Ϊ׼��   * �������ý�项�ͼ�����ġ����ѽ�项��������项�����֣����濴����   * ��ê����һ�����Բ��ϡ����Ǿͱ����㡸��֪����������ģ�ͻ�˳�űࡣ   */  private isWeak(memory: RecallResult): boolean {
    const top = memory.factual[0]?.breakdown.total ?? 0;
    if (memory.seeds.length === 0) return true;
    if (memory.factual.length === 0) return true;
    // ������ê�㵫�����ܵͣ�˵��ֻ�ǲ���
    return top < this.memoryCfg.wakeThreshold;
  }  /**   * ��仰�ǲ������ʡ���ȥ���¡���   *   * ���þ�����ֻ�ù����ʣ����ùܳ�����   * ���Ժ���ÿ��ֻ�ܿ�20����Ƶ���Ǹ�Ҫ�󣬻ش�����֡�20����ȫ������   * ��ǰһ����������������Լ��ļ���͹��ȫ��ɡ��Ҳ��ǵá���   */  private asksAboutPast(text: string): boolean {
    // �� ���ڡ��Ի������������ⲻ�������¡���������ʷ����ڼ���⡣
    if (/��仰|�ղ�|��˵|���|����|����˵|��˵��ʲô|��˵��ʲô|����һ��|����һ��/.test(text)) {
      return false;
    }    // �� ���롸�й�ȥ��ǡ�**��**��ȷʵ���ʡ����������¡�    //    ֻ����֮ǰ�������˳����䣺��֮ǰ���������ԡ�������֮ǰ�Ĺ������������ʡ�    //    ���˱�©���˺��󡪡�������������֪��ȴ˵��֪����
    const PAST = /�ǵ�|����|����|�Ǵ�|�ϴ�|�ϻ�|��ǰ|֮ǰ|����|�����|�Ĵ�|����|ʲôʱ��/;
    const ASKING = /[��?]|��|��|ʲô|��ô|��|˭|����|����|����|���ǲ�|�ǲ���|��û��|������|˵˵|����/;
    return PAST.test(text) && ASKING.test(text);
  }  /**   * �����һ�����м���������桹��ê�㡣   *   * �ⲻ�Ǽ������������ǡ�����ʲô��ʲô�������ǡ���Ȼ����˭����   * ���Բ�����ضȣ�ֻ������û��ʵ�����ݿɻ��䡣   */  randomAnchor(exclude: string[] = []): {
 name: string;
 kind: string;
 memories: string[] } | null {
    const rows = this.db      .prepare(        `SELECT a.id AS id, a.name AS name, a.kind AS kind, COUNT(ea.event_id) AS c         FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id         GROUP BY a.id HAVING c > 0`,      )      .all() as Array<{
 id: string;
 name: string;
 kind: string;
 c: number }>;
    if (rows.length === 0) return null;
    // �������Ĳ��������������һֱ��ͬһ�����ϴ�ת
    const fresh = rows.filter((r) => !exclude.includes(r.name));
    const pool = fresh.length > 0 ? fresh : rows;
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    const evs = this.db      .prepare(        `SELECT e.* FROM events e JOIN event_anchors ea ON ea.event_id = e.id         WHERE ea.anchor_id = ? AND e.archived = 0 ORDER BY e.ts DESC LIMIT 4`,      )      .all(pick.id) as Array<Record<string, unknown>>;
    // ˳�Ź�ϵ��������һ�����뵽��Ⱥ�ġ����͸��뵽�����š�����ṹ����С���ˡ���    // ֮ǰֻ�ñ����е���һ��ê�㣬��ϵ������ȴû���ϡ��������뷨���ǵ���ġ�
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
      // ��ϵ�������������˻ص�ê��
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
  }  /**   * ����һ��ê���Լ������飺�ȶ�Ŀ�ģ���ѡ;����   *   * �ĸ����������ӣ���ô���������¡��������һ��   * ��Ŀ�� + ;�����ľ�������;����������������ʲô��   *   ���� �� ȥ B վ/������   *   ���� �� ֱ�ӷ���Ϣ���Է�   *   ��   �� ���ֻ���һ���������   *   ���� �� ʲô������   */  async think(anchor: {
    name: string;
    kind: string;
    memories: string[];
    related?: Array<{
 name: string;
 weight: number;
 memories: string[] }>;
    stale?: boolean;
    repeats?: number;
  }): Promise<string> {
    const lines = [      `���Ȼ����${anchor.name}����${anchor.kind}����`,      anchor.memories.length > 0 ? "����������ǵã�" : "������������ʵʲô���ǲ����ˡ�",      ...anchor.memories.map((m) => `- ${m}`),      "",    ];
    // ˳�Ź�ϵ���뵽�ı���˺��¡�����һ����ǰ�ǿյģ�    // �����뷨���ǵ���ģ��뵽Ⱥ�ľ�ֻ�뵽Ⱥ�ģ��߲���ȥ��    // ֪ʶ�⣺�������ġ������ê���йصĶ�����    // ֮ǰ֪ʶ����˵�����û���������������һ�����ģ��õ�ʱ��һ�����벻������
    try {
      // ֻ�ҡ��������ê���ϡ���֪ʶ������������ƥ�䣬�����Լ������Ĺ���
      const names = [anchor.name, ...(anchor.related ?? []).map((r) => r.name)];
      const hits = kbForAnchors(this.cfg.dataDir, names, 4).map((e) => ({
        category: e.category,        title: e.title,        content: e.content,      }));
      if (hits.length > 0) {
        lines.push("��������ġ������йصġ�");
        for (const h of hits.slice(0, 4)) {
          lines.push(`- ��${h.category}��${h.title}��${h.content.replace(/\s+/g, " ").slice(0, 120)}`);
        }        lines.push("");
      }    } catch {
      // ֪ʶ�����������Ӱ������
    }    // ���ж��ٶԻ�û��ɼ��䡪����Сʱ�����һ�Σ���Ȼ��һֱ߶߶
    try {
      const pending = Number(        (this.db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get() as {
 c?: number } | undefined)?.c ?? 0,      );
      if (pending > 0 && canNudge(this.cfg.dataDir, "lastTidyNudge")) {
        lines.push(          `������ ${pending} �ֶԻ�û������`,          "����˵����Щ��û��ɼ��䣬Ҳ��û�����κ�ê�㡣",          "Ҫ��������һ���𣿣�memory_tidy���鲻������Ҳ������������˵������ûʲôֵ�üǵġ�",          "",        );
        markNudged(this.cfg.dataDir, "lastTidyNudge");
      }    } catch {
      // ���������Ͳ���
    }    if (anchor.related && anchor.related.length > 0) {
      lines.push(        `˳�š�${anchor.name}���㻹�뵽��${anchor.related.map((r) => r.name).join("��")}��`,        "",      );
      for (const r of anchor.related) {
        if (r.memories.length === 0) continue;
        lines.push(`��${r.name}��`);
        for (const m of r.memories) lines.push(`- ${m}`);
        lines.push("");
      }      lines.push(        "�⼸�������ŵġ���ֻ���ŵ�һ������**�����Ǵ����������ܲ��ܵó�һ������**��",        "",      );
    }    if (anchor.stale || (anchor.repeats ?? 0) >= 2) {
      lines.push(        `?? ��${anchor.name}�������������Ѿ���� ${anchor.repeats ?? 2} ���ˣ�����һ�鲻�����¶�����`,        "������α���ԭ�ش�ת����ȥ**��ȡ�µ�֪ʶ**������������ʲô�����ʱ��ˡ��ҵ��㻹��֪���ġ�",        "",      );
    }    lines.push(      "����û�˸���˵�������Լ���ĥ��",      "1. �ҵ�����Ū����ʲô / ������ʲô��",      "2. ����·�ܵ���ȥˢ���ݣ�Bվ/�������������ġ��������ֻ���һ��������£�",      "3. Ҫ��Ҫ����һ�¼��䣿��memory_tidy�����ŵĶԻ����ˡ����߾��ø���һ���ˣ����Լ�����˯һ����",      "4. ��û��ʲô�����ֵ�ü�����������û����ס�ģ���memory_save����һ����ǰ�Ǳ��������жϵġ�",      "5. ��û��©�ǣ���memory_recent �������ԭʼ�Ի��������ü�ȴû�ǵģ��� memory_save ���ϣ�",      "",      "������ھͲ飨���й��ߣ����������ھ�����",      "�����������������ʽ�ϸ��ճ����������У�",      "Ŀ�ģ���һ�仰��˵����Ҫʲô��",      ";������ֻ���ǣ����� / ���� / �� / ���ˣ�",      "��Ϣ����ֻ��;��=����ʱ���д��Ҫ����ȥ���Ǿ仰������������գ�",      "",      "���ʶԷ�ʲô��������Ҫ����æ����ѡ�����졹�������Լ����š�",      "�����ˡ�Ҳ���ԡ���û������ɵľ�ֱ˵����ա�",    );
    return this.act(lines.join("\n"), loadTuning(this.cfg.dataDir).maxToolRounds);
  }  /**   * ����ֻ����ڲ��ڣ����Ų�ε������ߡ�   *   * ֮ǰֻ������ʱ�ж�һ�Σ���������Զ��� USB -> �ֻ�����ȫû�ˣ�   * ���Ҳ�������������������Լ���Ӧ��   */  refreshPhoneTools(): void {
    if (!this.tools) return;
    try {
      const attached = attachPhoneTools(this.tools, this.cfg);
      if (attached) {
        if (!this.phoneAttached) {
          this.phoneAttached = true;
          console.log("[tools] �ֻ������ˣ��ֻ������ѹ���");
        }        return;
      }      if (this.phoneAttached) {
        const removed = detachPhoneTools(this.tools);
        this.phoneAttached = false;
        if (removed.length > 0) console.log(`[tools] �ֻ����ˣ�ժ�� ${removed.length} ���ֻ�����`);
      }    } catch (err) {
      console.warn("[tools] ����ֻ�ʱ����:", err instanceof Error ? err.message : String(err));
    }  }  /**   * �ղ��ǲ����ڸ��¡�   *   * ���񲻸�������æ��ʱ�����������������ֻ������ڻػ���   * ������һ���»�û����������ʱ�����קȥ�����£����ڴ�ϡ�   */  busyRecently(withinMs = 90_000): boolean {
    return this.lastActivityAt > 0 && Date.now() - this.lastActivityAt < withinMs;
  }  /** ������׼ 1234 / �� 1234�� */  resolveApproval(shortId: string, approve: boolean): Approval | null {
    return resolveApproval(this.db, shortId, approve);
  }  /** ֱ�ӵ�һ�����ߣ���׼֮��ִ���ã� */  async callTool(name: string, args: Record<string, unknown>): Promise<{
 ok: boolean;
 text: string } | null> {
    if (!this.tools) return null;
    return this.tools.call(name, args);
  }  /**   * ȡ�Ի���ʷ���ڴ���û�оʹ����ݿ����̻�����   *   * ֮ǰ��ʷֻ�����ڴ棺һ�����Ϳգ�����������ͷ��������ȫ��֪����˵ʲô   * ����Ϊʲô�뵥��������һ�ݡ�������˵������ָ˭��������   * �Ի������ʹ��� turns �û���ɲ��á�   */  private historyFor(sessionId: string): Array<{
 role: "user" | "assistant";
 text: string;
 speaker?: string }> {
    const cached = this.history.get(sessionId);
    if (cached && cached.length > 0) return cached;
    try {
      const rows = this.db        .prepare("SELECT role, text, speaker_id FROM turns ORDER BY seq DESC LIMIT ?")        .all(HISTORY_LIMIT) as Array<{
 role: string;
 text: string;
 speaker_id: string }>;
      if (rows.length === 0) return [];
      // ˵�������֣�Ⱥ�ﲻֹһ���ˣ���������ͻᱻ����ͬһ��������˵
      const nameOf = new Map<string, string>();
      try {
        for (const p of listPeople(this.db)) nameOf.set(p.qqId, p.name || p.qqId);
      } catch {
        // û�� people ��������
      }      const restored = rows        .reverse()        .map((r) => ({
          role: (r.role === "user" ? "user" : "assistant") as "user" | "assistant",          text: String(r.text ?? ""),          speaker: r.role === "user" ? nameOf.get(String(r.speaker_id ?? "")) ?? "" : "",        }))        .filter((m) => m.text.length > 0);
      this.history.set(sessionId, restored);
      console.log(`[ctx] �ӿ���ָ��� ${restored.length} ���Ի�������`);
      return restored;
    } catch {
      return [];
    }  }  /**   * ���¡����Լ�˵����仰����   *   * ֮ǰ������������Ϣ�����Ի���ʷ��������ѹ�����ǵ��Լ�˵������   * ���ԭ������ȥ���������������˵��Ȼ����ϡ�   */  recordSaid(text: string): void {
    const t = String(text ?? "").trim();
    if (t.length === 0) return;
    try {
      ingestTurns(this.db, [{
 day: dayKey(Date.now()), role: "assistant", text: t, speakerId: String(this.cfg.selfId) }]);
    } catch {
      // �ǲ��ϲ�Ӱ��˵��
    }  }  /**   * ��פ���䣺��أ�feedback���͡�����˭����user����   *   * �����಻�ܿ�������������û����������˵��Ҫ���ޡ���������Ĳ�ȥ���ޡ�   */  alwaysOnMemories(limit = 8, speakerId = ""): Array<{
 kind: string;
 text: string }> {
    try {
      // ��أ�feedback����ȫ�ֵģ�������˭����user��ֻ������˵���Ǹ���
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
    }  }  /** �ش�ͷ���������������vv�������ֱ�ǩ��ȥ����������������ʷ��ѧ���ĸ�ʽ */  private stripNamePrefix(text: string): string {
    return String(text ?? "").replace(/^[^\s��:]{1,12}[��:]\s*/, (m) => (/^(��|vv|��|�Է�|��)[��:]\s*$/.test(m) ? "" : m));
  }  /** ѧһ���´ʣ������ڻ�����ͷ�������´������ʹ����� */  learnTerm(term: string, meaning: string): boolean {
    try {
      return learnTerm(this.cfg.dataDir, term, meaning, "ѧ����");
    } catch {
      return false;
    }  }  /** ÿ���������ʵ���֡������ڶԻ����ᵽ�����ж�������ʱ�������������ƾӡ�� */  liveStats(): {
 events: number;
 anchors: number;
 edges: number;
 pending: number } {
    const one = (sql: string): number => Number((this.db.prepare(sql).get() as {
 c?: number } | undefined)?.c ?? 0);
    return {
      events: one("SELECT COUNT(*) AS c FROM events WHERE archived = 0"),      anchors: one("SELECT COUNT(*) AS c FROM anchors"),      edges: one("SELECT COUNT(*) AS c FROM edges"),      pending: one("SELECT COUNT(*) AS c FROM turns WHERE processed = 0"),    };
  }  /** ��һ������д�����䣨����Ҳ������ֻ�ǽ��ۣ� */  recordThoughtNote(input: {
 anchor: string;
 related: string[];
 goal: string;
 channel: string;
 message?: string }): void {
    try {
      recordThought(this.db, input, Date.now());
    } catch {
      // д������Ӱ������
    }  }  /** �����Ѿ�����˵�˼��� */  proactiveUsedToday(): number {
    return quotaUsed(this.db, "proactive");
  }  /** ��һ���������� */  countProactive(): void {
    quotaSpend(this.db, "proactive", this.cfg.proactiveDailyLimit);
  }  /**   * ����Ҫ��Ҫ˵����˵ʲô��   *   * �ؼ���**����Ȩ��Ĭ**�����ء���Ĭ�����ǲ�˵��   * һ�����뿪�ڵĻ����ˣ����ֻ���ɶ�ʱ�ʺ����   */  async speakUp(info: {
 idleMinutes: number;
 used: number;
 limit: number }): Promise<string> {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return this.act(      [        `������ ${hh}:${mm}���� ${info.idleMinutes} ����û˵���ˡ�`,        info.limit > 0          ? `������Ѿ������ҹ��� ${info.used} �Σ����� ${info.limit} �Σ���`          : `������Ѿ������ҹ��� ${info.used} �Σ�û�д������ơ�`,        "",        "�������˵��ʲô��",        "- ûʲô����˵�ģ���ֻ�������֣���Ĭ",        "- ��˵�ģ���ֱ��д��Ҫ������һ�仰��һ�����䣩����Ҫ���͡���Ҫ�����š���Ҫд�԰�",        "",        "�л���˵��û���ͱ�˵������Ϊ���Ե���������ڡ�",        "����˵��տ����Ķ������뵽���£�����һ�����ĵĹ��ġ�",        "",        "�����������**�����ɵ��Լ�����������**��������Ҫ��ʲô��һ��������һ�����ߡ����İ�æ����",        "�����Ǹ���ʱ��˵���������ò�����˼����Ҫ˵���壺",        "- �ã������뿴�ö���Ƶ���棬�����Ļ�����������ܿ�ͼ��ģ�͡�",        "- �ã������ֻ��ϵĶ����򲻿�������ҿ����ǲ���Ȩ�����⡹",        "- ��������ҡ�����ʲô�������ˡ�",        "ȷʵûʲô��Ҫ�ģ��ͳ�Ĭ��������Ϊ��Ҫ��������һ����",      ].join("\n"),    );
  }  /**   * �ջ���һ�䣬���벹һ����   *   * ���������ﲻ��һ��һ��˵����Լ��ٲ���䡢������¡�   * ����Цһ�¡�����������ǲ��ǰ�䡣   */  async followUp(previous: string[] = []): Promise<string> {
    const said =      previous.length > 0 ? ["", "��ղŸ���˵���ǣ�", ...previous.map((t) => `  ��${t}��`)].join("\n") : "";
    const out = await this.act(      [        "��ջ�����һ�䡣",        "�����µ�������벹������ͷ������������ֻ�أ���Ĭ",        "���Բ��䡢���ڡ�����һ���¡������κ�����˵�Ļ��������ظ��ղ�˵���Ļ���",        "������Щ��˵���ˡ�û��Ҫ�ٻ�ͷ������ֻ�������֣�����",
        "����д�����ˣ�ûʲôҪ���ġ������Ǿ仰�ᱻ������Ҫ���Ļ�����ȥ��",        said,      ]        .filter((x) => x.length > 0)        .join("\n"),    );
    const t = out.trim();
    return t.startsWith("��Ĭ") ? "" : t;
  }  /** ��һ���ʼ�ֱ��д�����䣨�Ķ�Ա����������������·����֤�����ͼǵã� */  recordNote(text: string): void {
    try {
      recordOwnNote(this.db, text, Date.now());
    } catch (err) {
      console.warn("[bot] �Ǳʼ�ʧ��:", err instanceof Error ? err.message : String(err));
    }  }  /** �ѹ��߱�����ȥ���Ķ�ԱҪ��ͬһ��������ֻȡ������һ���֣� */  toolRegistry(): ToolRegistry | null {
    return this.tools;
  }  /** �ش����������ʱ����Щ�ı�Ҳ�㡸�����ݡ�����Դ */  private knownText(): string {
    const t = this.todaySnapshot();
    return [readSelf(this.cfg.dataDir), t.watched.join("\n"), t.notes.join("\n")].join("\n");
  }  /** ���쿴��ʲô������ʲô����פע�룬���������� */  todaySnapshot(): {
 watched: string[];
 notes: string[] } {
    const today = new Date().toISOString().slice(0, 10);
    const watched = this.watchedToday();
    const noteRows = this.db      .prepare("SELECT title FROM events WHERE day = ? AND context_kinds LIKE ? ORDER BY ts DESC")      .all(today, "%own-note%") as Array<{
 title: string }>;
    return {
 watched, notes: noteRows.map((r) => r.title) };
  }  /** �����Ѿ�������Щ��Ƶ�����������ʾ�ã� */  watchedToday(): string[] {
    const today = new Date().toISOString().slice(0, 10);
    const rows = this.db      .prepare("SELECT bvid, title FROM watched_videos WHERE day = ? ORDER BY watched_at DESC")      .all(today) as Array<{
 bvid: string;
 title: string }>;
    return rows.map((r) => (r.title.length > 0 ? r.title : r.bvid));
  }  /** ������Ķ�ȿ��� */  autonomyBudget(): {
    videoLeft: number;
    videoLimit: number;
    writeLeft: number;
    writeLimit: number;
    roundsLeft: number;
    roundsLimit: number;
  } {
    const videoLimit = this.cfg.biliDailyVideoQuota;
    const writeLimit = this.cfg.biliDailyWriteLimit;
    const roundsLimit = this.cfg.autonomyDailyRounds;
    return {
      videoLeft: Math.max(0, videoLimit - quotaUsed(this.db, "video")),      videoLimit,      writeLeft: Math.max(0, writeLimit - quotaUsed(this.db, "write")),      writeLimit,      roundsLeft: Math.max(0, roundsLimit - quotaUsed(this.db, "autonomy")),      roundsLimit,    };
  }  /**   * �������һ�֣�û����˵�������Լ�������ʲô��   *   * �� handle �����𣺲�����ԭʼ�Ի����������þ����أ��������ڱ��ʣ���   * ֻ�ѡ��Լ������Լ��Ķ�Ƚ�������   */  async act(instruction: string, maxRounds = 8): Promise<string> {
    this.lastActivityAt = Date.now();
    const budget = this.autonomyBudget();
    const memory = recall(this.db, this.memoryCfg, instruction.slice(0, 60), {
 sessionId: "autonomy" });
    const messages = buildChatPrompt({
      memory,      userName: "����",      history: [],      message: instruction,      memoryWeak: false,      ...this.promptExtras(),    });
    const out = await this.respond(messages, maxRounds);
    return out.text;
  }  /** ÿ�ο���ǰ�����ϣ����Լ�д���������� + ���컹ʣ���ٶ�� */  private promptExtras(evt?: {
 isGroup?: boolean;
 groupId?: number;
 userId?: number;
 userName?: string;
 sender?: {
 card?: string;
 nickname?: string } }): {
    toolNames?: string[];
    selfText: string;
    quota: {
 videoUsed: number;
 videoLimit: number;
 writeUsed: number;
 writeLimit: number };
    today: {
 watched: string[];
 notes: string[] };
  } {
    return {
      toolNames: this.tools?.names(),      selfText: readSelf(this.cfg.dataDir),      today: this.todaySnapshot(),      quota: {
        videoUsed: quotaUsed(this.db, "video"),        videoLimit: this.cfg.biliDailyVideoQuota,        writeUsed: quotaUsed(this.db, "write"),        writeLimit: this.cfg.biliDailyWriteLimit,      },      // �����뵱ǰ˵���ˣ������� promptExtras ���      // handle() �ߵ����������ŵ��𴦵���û�ӣ�����ӽ���ȹ�����
      scene: (() => {
        if (!evt?.isGroup) return "˽�ġ�ֻ��������������˵����";
        return `QQ Ⱥ��Ⱥ�� ${evt.groupId ?? "δ֪"}��������Ⱥ�ģ�����˽�ġ�Ⱥ�ﻹ�б����ڿ���`;
      })(),      currentSpeaker: (() => {
        const c = String(evt?.sender?.card ?? "").trim();
        const n = String(evt?.sender?.nickname ?? "").trim();
        return c || n || String(evt?.userName ?? evt?.userId ?? "");
      })(),      currentSpeakerQq: String(evt?.userId ?? ""),    };
  }  /**   * ͳһ���ڣ��й��߾��߹��ߵ��ã�û�о�����ͨ��ȫ��   *   * ���ߵ���ֻ�� DeepSeek ���� OpenAI ���ݽӿ��Ͽ��ã�   * ���� Ollama ֱ������ͨ��ȫ����û�� function calling����   */  private async respond(    messages: Array<{
 role: "system" | "user" | "assistant";
 content: string }>,    maxRounds = 8,  ): Promise<{
 text: string;
 toolText: string }> {
    // Ǯ��Ψһ���������Ķ�������Ԥ�����Ͳ���ģ����
    const cost = todayCost();
    if (cost.exhausted) {
      return {
 text: `����Ķ�������ˣ�${cost.budgetYuan} �飬�ѻ� ${cost.yuan} �飩��������˵��`, toolText: "" };
    }    if (this.tools && this.cfg.provider === "deepseek") {
      const result = await runChatWithTools(        {
          baseUrl: this.cfg.deepseekBaseUrl,          apiKey: this.cfg.deepseekApiKey,          model: this.cfg.deepseekModel,          temperature: loadTuning(this.cfg.dataDir).replyTemperature,          timeoutMs: 90_000,        },        messages,        this.tools,        maxRounds,      );
      if (result.calls.length > 0) {
        this.counters.toolCalls += result.calls.length;
      }      // ���߷��ص�����Ҳ�ǡ��Ϸ���ʵ��Դ���������þ��������ܰ���������
      return {
 text: result.text, toolText: result.calls.map((c) => c.result).join("\n") };
    }    return {
 text: (await this.replyAdapter.complete(messages, {
 timeoutMs: 120_000 })).trim(), toolText: "" };
  }  /** �����ã����߰������������̣�ֱ�Ӱ�һ�仰����������· */  async say(text: string, userName = "����"): Promise<{
 reply: string;
 memory: string }> {
    const memory = recall(this.db, this.memoryCfg, text, {
 sessionId: "debug" });
    const weak = this.isWeak(memory) && this.asksAboutPast(text);
    const messages = buildChatPrompt({
      memory,      userName,      history: [],      message: text,      memoryWeak: weak,      people: (() => {
        try {
          return listPeople(this.db);
        } catch {
          return [];
        }      })(),      peopleQq: "",      currentSpeakerQq: "",      currentSpeaker: (() => {
        const s = (evt as {
 sender?: {
 card?: string;
 nickname?: string } }).sender;
        const c = String(s?.card ?? "").trim();
        const n = String(s?.nickname ?? "").trim();
        return c || n || String(evt.userName ?? "");
      })(),      // ����������֪������Ⱥ����˽�ģ���Ȼ���Ⱥ�ĵ���һ�Զ�˽��
      scene: (() => {
        if (!false) return "˽�ġ�ֻ��������������˵����";
        const speakers = (() => {
          try {
            return this.db              .prepare("SELECT DISTINCT speaker_id FROM turns WHERE speaker_id <> '' AND ts > ?")              .all(Date.now() - 2 * 86_400_000) as Array<{
 speaker_id: string }>;
          } catch {
            return [];
          }        })();
        const names = (() => {
          try {
            const map = new Map(listPeople(this.db).map((p) => [p.qqId, p.name]));
            return speakers.map((s) => map.get(s.speaker_id) ?? s.speaker_id).filter(Boolean);
          } catch {
            return [];
          }        })();
        return [          `QQ Ⱥ��Ⱥ�� ${0 ?? "δ֪"}��������Ⱥ�ģ�����˽�ġ�`,          names.length > 0 ? `��������Ⱥ��˵�������У�${names.join("��")}�����б����ڿ���` : "Ⱥ�ﻹ�б����ڿ���",        ].join("");
      })(),      stats: this.liveStats(),      alwaysOn: this.alwaysOnMemories(8, ""),      uptime: describeUptime(readUptime(this.cfg.dataDir)),      terms: matchTerms(this.cfg.dataDir, text),      ...this.promptExtras(),    });
    const out = await this.respond(messages);
    let reply = this.stripNamePrefix(out.text);
    if (weak && this.asksAboutPast(text) && looksFabricated(reply, `${memory.contextBlock}\n${out.toolText}\n${this.knownText()}`)) {
      if (out.toolText.length > 0) {
        console.warn("[bot] �й��߽��֧�ţ����Գ��ּ�����û�еľ�����ʵ�����е���һ��");
      } else {
        reply = `${noMemoryReply()}��ԭ�ش�δ���صľ�����ʵ�������£�`;
      }    }    return {
 reply, memory: memory.contextBlock };
  }  /** һ����Ϣ������������ �� ��һ�� �� ��һ�� */  async handle(evt: IncomingMessage): Promise<string | null> {
    this.lastActivityAt = Date.now();
    // ˭��˵����QQ �������ݣ��ǳ��ǵȼ۳ƺ�
    try {
      // �����������ˣ�Ⱥ��Ƭ �� QQ�ǳ� �� QQ<��>
      const sender = (evt as {
 sender?: {
 card?: string;
 nickname?: string } }).sender;
      const card = String(sender?.card ?? "").trim();
      const nick = String(sender?.nickname ?? "").trim();
      const finalName = card || nick || String(evt.userName ?? evt.userId);
      ensurePerson(this.db, evt.userId, finalName);
      // ��Ƭ���ǳƶ����ɱ�����ͬһ���˻���Ƭ�������ϳ���
      if (card && nick && card !== nick) addAlias(this.db, String(evt.userId), nick);
    } catch {
      // �����ϲ�Ӱ��ػ�
    }    this.counters.received += 1;
    this.lastMessageAt = Date.now();
    if (evt.userId === evt.selfId) {
      this.counters.ignored += 1;
      return null;
    }    // �� [CQ:face,id=467] ������ת���˻��������飺ҡ���֣�    // �����۾���һ��ͼ���ٽ��� CQ ������ͼ�����˻�������֪���Է�����ʲô��
    const seenText = await describeImagesInText(evt.text, this.cfg.dataDir);
    const text = describeCqCodes(seenText).trim();
    if (text.length === 0) {
      this.counters.ignored += 1;
      return null;
    }    if (!this.allowed(evt)) {
      this.counters.ignored += 1;
      return this.cfg.strangerReply.length > 0 ? this.cfg.strangerReply : null;
    }    // Ⱥ��Ĭ��ֻ�ڱ� @ ʱ���ڣ������ˢ����Ҳ��� GPU ����    // ÿ��Ⱥ�������Լ���ģʽ�����Լ���ģ���û��Ͱ�ȫ��
    const groupMode =      evt.isGroup && evt.groupId !== undefined        ? modeFor(this.cfg.dataDir, evt.groupId, this.cfg.groupReplyMode)        : this.cfg.groupReplyMode;
    if (evt.isGroup && groupMode === "mention" && evt.mentioned !== true) {
      if (this.cfg.recordGroupChat) {
        try {
          ingestTurns(this.db, [{
 day: dayKey(Date.now()), role: "user", text, speakerId: String(evt.userId) }]);
        } catch {
          // �ǲ��Ͼ�����
        }      }      this.counters.ignored += 1;
      return null;
    }    // 1. ������ԭʼ�Ի���˯��ʱ������������ֻ�ǣ�
    try {
      ingestTurns(this.db, [{
 day: dayKey(Date.now()), role: "user", text, speakerId: String(evt.userId) }]);
    } catch (err) {
      console.error("[bot] ��¼�Ի�ʧ��:", err);
    }    // 2. ��һ�£��ٻؼ���
    let memory: RecallResult;
    try {
      // ��������ֻ����ǰ��һ�䣺���Ǽ�����ô���ˡ������ء����֣�����һ��ʲô���Ѳ�����    // ��������ֵ���ǰ�棬�ü���֪�����Ǽ��¡�ָ����ʲô��
    const ctxTail = this.historyFor(evt.sessionId)      .slice(-2)      .map((h) => h.text)      .join(" ")      .slice(-120);
    const recallQuery = `${ctxTail} ${text}`.trim();
    memory = recall(this.db, this.memoryCfg, recallQuery, {
 sessionId: evt.sessionId, speakerId: String(evt.userId) });
    } catch (err) {
      console.error("[bot] �ٻ�ʧ��:", err);
      this.counters.failed += 1;
      return fallbackReply();
    }    // 3. ��һ��    // ֻ�С����ʹ�ȥ���¡��Ű����������䣻��ָ����ġ��ʹ۵㶼����
    const weak = this.isWeak(memory) && this.asksAboutPast(text);
    const messages = buildChatPrompt({
      memory,      userName: evt.userName,      history: this.historyFor(evt.sessionId),      message: text,      memoryWeak: weak,      stats: this.liveStats(),      ...this.promptExtras(evt),    });
    let reply: string;
    let toolText = "";
    try {
      const out = await this.respond(messages);
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
          history: this.historyFor(evt.sessionId),
          message: text,
          memoryWeak: weak,
          stats: this.liveStats(),
          ...this.promptExtras(evt),
        });
        const out2 = await this.respond(retry);
        if (String(out2.text).trim().length > 0) {
          out.text = out2.text;
          toolText = out2.toolText;
        }
      }
      reply = this.stripNamePrefix(out.text);
      toolText = out.toolText;
      if (reply.length === 0) throw new Error("�ջظ�");
    } catch (err) {
      console.error("[bot] ���ɻظ�ʧ��:", err);
      this.counters.failed += 1;
      return fallbackReply();
    }    // 3.5 �º�У�飺û�м���֧�ŵĻش�����־�����ʵ���͵����촦��    // ���߷��ص�������Ϸ���Դ���й��߽��ʱ������ֻ��һ��    // ��ͼ����·���� QQ ��û�á���ֱ�ӷ���ȥ
    if (this.opts.onImage) {
      const shot = /(<path>)?([A-Za-z]:\\\\[^\s"']+shot-\d+\.png|data[\\\\/]screenshots[\\\\/]shot-\d+\.png)/.exec(toolText || "");
      if (shot) {
        try {
          await this.opts.onImage(shot[2]!);
        } catch (err) {
          console.warn("[bot] ��ͼʧ��:", err instanceof Error ? err.message : String(err));
        }      }    }    if (weak && this.asksAboutPast(text) && looksFabricated(reply, `${memory.contextBlock}\n${toolText}\n${this.knownText()}`)) {
      console.warn(`[bot] ����һ��û�м���֧�ŵĻش�${reply.slice(0, 60)}`);
      this.counters.failed += 1;
      reply = noMemoryReply();
    }    // 4. ��ס��һ�֣�ֻ������������������������ͣ�
    const hist = this.historyFor(evt.sessionId);
    hist.push({
 role: "user", text });
    hist.push({
 role: "assistant", text: reply });
    this.history.set(evt.sessionId, hist.slice(-HISTORY_LIMIT));
    // 5. �������Լ��Ļ�Ҳ���̣�ֻ��Ϊ�Ի���¼����ȡʱ�ᱻ���������������ļ��䣩
    try {
      ingestTurns(this.db, [{
 day: dayKey(Date.now()), role: "assistant", text: reply }]);
    } catch (err) {
      console.error("[bot] ��¼�ظ�ʧ��:", err);
    }    console.log(`[��Ϣ] ${evt.userName}: ${text.slice(0, 60)}`);
    console.log(`[�ظ�] ${reply.slice(0, 80)}`);
    this.counters.replied += 1;
    return reply;
  }  /** �ֶ�˯һ�������Ժ͡������������ã������������ж� */  async sleepNow(now = Date.now()): Promise<SleepStats | null> {
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
    }  }  /**   * ˯�ߣ��ѻ��۵ĶԻ������ɼ��䡣   *   * ��������������   *  - ˵��ͣ�����ļ����ӣ�idleSleepMinutes����**������Ҫ��**��   *    ��ǰ�� 3 Сʱ�����������������һ���硢�м��������Σ�   *    ������һ����û�С��������ŵȳ�˯�����ڡ���Զ��˯����   *  - ���������ã�idleSleepHours����û��˵��������ʰһ�飻   *  - ÿ��̶�ʱ�̣�dailySleepHour�������ס�   *   * ˯���ں�̨�ܣ�����������Ϣ����˯���ڼ����Ļ��ճ��أ�ֻ���Ȳ�������   */  async maybeSleep(now = Date.now()): Promise<SleepStats | null> {
    if (this.sleeping) return null;
    if (pendingTurns(this.db) === 0) return null;
    const today = dayKey(now);
    const hour = new Date(now).getHours();
    const idleShort =      this.cfg.idleSleepMinutes > 0 && now - this.lastMessageAt >= this.cfg.idleSleepMinutes * 60_000;
    const idleHit = this.cfg.idleSleepHours > 0 && now - this.lastMessageAt >= this.cfg.idleSleepHours * 3_600_000;
    // ÿ��ֻ��ָ������������һ�Σ�Ĭ���賿 3-5 �㣩
    const win = this.cfg.dailySleepWindow;
    const inWindow =      win !== null && (win[0] <= win[1] ? hour >= win[0] && hour < win[1] : hour >= win[0] || hour < win[1]);
    const dailyHit =      (inWindow || (this.cfg.dailySleepHour !== null && hour === this.cfg.dailySleepHour)) &&      this.lastSleepDay !== today;
    // �ܹ��˾�˯��������û�������ġ�    // ֮ǰֻ����û��˵�������������һֱ�ġ�һֱ��˯��ê��֮��Ĺ�ϵһ����û���ϡ�
    const pendingNow = pendingTurns(this.db);
    const pendingHit = this.cfg.sleepForceThreshold > 0 && pendingNow >= this.cfg.sleepForceThreshold;
    if (!idleShort && !idleHit && !dailyHit && !pendingHit) return null;
    // �������Ա߾�˵һ������������Ϊ��������
    if (pendingHit && this.cfg.announceSleep && !idleShort) {
      try {
        this.opts.notify?.(`�е����ˣ���ȥ˯һ��������������� ${pendingNow} ���Ի�������һ�����������ġ�`);
      } catch {
        // ˵��˵����Ӱ��˯
      }    }    // ƽʱ�Ǽ��Σ�ͣ 3 ���� / ͣ 12 Сʱ��ֻ����**���»�û�����ĶԻ�**��    // ÿ���Ǵδ�˯��Ҫ��**һ����**���¹�һ�顪��ͬһ����·���һ�𿴣�    // �Ŷ��ó������������˵�£�����˵û���ˡ�����ֻ�������������ſ��ó�������
    if (dailyHit) {
      this.db.prepare("UPDATE turns SET processed = 0 WHERE day = ?").run(today);
    }    this.sleeping = true;
    try {
      const stats = await sleepAsync(this.db, this.memoryCfg, {
 nowTs: now }, this.extractAdapter);
      this.counters.sleeps += 1;
      this.counters.lastSleepAt = now;
      this.lastSleepDay = today;
      console.log(        `[bot] ˯����ɣ�${stats.eventsExtracted} ���¼���ռ�� ${stats.totalTokens} token����ȡ�� ${this.memoryCfg.extractor}`,      );
      return stats;
    } catch (err) {
      console.error("[bot] ˯��ʧ��:", err);
      return null;
    } finally {
      this.sleeping = false;
    }  }  /** ��̨��ʱ����ÿ���ӿ�һ�θò���˯ */  startScheduler(intervalMs = 60_000): () => void {
    const timer = setInterval(() => {
      void this.maybeSleep();
    }, intervalMs);
    return () => clearInterval(timer);
  }  close(): void {
    this.db.close();
  }}/** �����þ����ñ��� Ollama ���� DeepSeek API */export function createChatAdapter(cfg: BotConfig): LlmAdapter {
  if (cfg.provider === "deepseek") {
    return new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);
  }  return new OllamaAdapter(cfg.ollamaBaseUrl, cfg.ollamaModel);
}/** �����ã��̶��ظ��ļ�ģ�ͣ����� Ollama */export function makeFakeReplyAdapter(text: string): LlmAdapter {
  return {
 name: "fake", complete: async () => text };
}