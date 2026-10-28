import type { BotConfig } from "./config.ts";
import type { BotService } from "./service.ts";
import type { Reading } from "./reading.ts";
import { appendJournal } from "../tools/journal.ts";
import { dayKey } from "../util.ts";
import {
  describeItem,
  expireOld,
  loadQueue,
  markItem,
  pendingOf,
  queueStats,
  saveQueue,
  stampLocal,
  type QueueItem,
} from "../queue.ts";

/**
 * 批处理：把队列里攒着的「想做」一次性做掉。
 *
 * 为什么要有它：走神以前「决定去做」就立刻动手——今天 188 次，每次一整轮
 * 模型请求（人格 + 63 个工具 + 召回，约 3 万 token）。攒成批之后：
 *
 *   现在  443 次调用 / 17.05M token / ¥4.8 一天
 *   改后  走神只记账 + 约 19 批 / ~3M token / ≈¥1.2 一天
 *
 * 三条边界：
 *   1. **只做 light / deep**。heavy（读 B 站、读屏、读长文件）不进这里——
 *      那些正文一进主上下文就要每轮重发，省下来的钱会全被吃回去。
 *   2. 批处理里**不给 bili_subtitle**（同上，字幕太长），也不给手机工具。
 *   3. 每批最多 10 条；没销掉的标失败、留着下次再试。
 */

/** 批处理能用的工具：去掉手机和「读长文本」的 */
const batchTools = (name: string): boolean => !name.startsWith("phone_") && name !== "bili_subtitle";

/** 最老的一条等多久就强制跑一批（2026-10-28：30 分钟 → 90 分钟，她一天大概 7 分钟记一件，凑 10 件要 70 分钟） */
const STALE_MINUTES = 90;

/** heavy 的节流：两次之间至少隔 10 分钟，一天最多 6 条（每条约 ¥0.09） */
const HEAVY_GAP_MS = 10 * 60_000;
const HEAVY_DAILY_CAP = 6;

export interface BatchRunResult {
  ran: boolean;
  reason: string;
  done: number;
  failed: number;
  said: string;
}

export class BatchRunner {
  private cfg: BotConfig;
  private service: BotService;
  private reading: Reading | null;
  private isBusyElswhere: (() => boolean) | null;
  private busy = false;
  /** 上一批跑完的时间：防止两条触发条件同时命中时连跑两批 */
  private lastRunAt = 0;
  private lastHeavyAt = 0;
  private heavyToday = 0;
  private heavyDay = "";

  constructor(
    cfg: BotConfig,
    service: BotService,
    opts?: { reading?: Reading; isBusy?: () => boolean },
  ) {
    this.cfg = cfg;
    this.service = service;
    this.reading = opts?.reading ?? null;
    this.isBusyElswhere = opts?.isBusy ?? null;
  }

  /** 走神正在想事的时候别插进来（两边都会调模型、都会写库） */
  private occupied(): string {
    if (this.busy) return "上一批还没跑完";
    if (this.isBusyElswhere?.()) return "走神正在想事";
    if (this.service.busyRecently(30_000)) return "刚有人在说话";
    return "";
  }

  /** 该不该现在跑一批（纯判断，不花钱） */
  shouldRun(now = Date.now()): { ok: boolean; reason: string } {
    if (this.busy) return { ok: false, reason: "上一批还没跑完" };
    if (now - this.lastRunAt < 60_000) return { ok: false, reason: "刚跑过一批，缓一分钟" };

    const s = queueStats(this.cfg.dataDir);
    const todo = s.light + s.deep;
    if (todo === 0) {
      return { ok: false, reason: s.heavy > 0 ? `只有 heavy ${s.heavy} 条，单独走阅读员` : "队列空的" };
    }
    if (todo >= 8) return { ok: true, reason: `攒够 ${todo} 条` };
    if (s.deep >= 3) return { ok: true, reason: `深任务攒够 ${s.deep} 条` };
    if (s.oldestMinutes >= STALE_MINUTES) return { ok: true, reason: `最老的一条等了 ${s.oldestMinutes} 分钟` };
    return { ok: false, reason: `才 ${todo} 条，最老的等了 ${s.oldestMinutes} 分钟` };
  }

  /** heavy 该不该跑（读 B 站这类，单独走阅读员） */
  shouldRunHeavy(now = Date.now()): { ok: boolean; reason: string } {
    if (!this.reading) return { ok: false, reason: "没有阅读员" };
    const day = stampLocal(new Date(now)).slice(0, 8);
    if (day !== this.heavyDay) {
      this.heavyDay = day;
      this.heavyToday = 0;
    }
    if (this.heavyToday >= HEAVY_DAILY_CAP) return { ok: false, reason: `今天已经读了 ${this.heavyToday} 条 heavy，够了` };
    if (now - this.lastHeavyAt < HEAVY_GAP_MS) return { ok: false, reason: "刚读过一条，隔 10 分钟" };
    const s = queueStats(this.cfg.dataDir);
    if (s.heavy === 0) return { ok: false, reason: "没有 heavy 待办" };
    return { ok: true, reason: `${s.heavy} 条 heavy 待读` };
  }

  /**
   * 跑一条 heavy：派阅读员去读，读完把结果记回队列。
   * 这是唯一会真的去 B 站读的路径——批处理里拿不到 bili_subtitle，就是为了不让这条混进去。
   */
  async runHeavyOnce(): Promise<BatchRunResult> {
    const gate = this.shouldRunHeavy();
    if (!gate.ok) return { ran: false, reason: gate.reason, done: 0, failed: 0, said: "" };
    const occupied = this.occupied();
    if (occupied.length > 0) return { ran: false, reason: occupied, done: 0, failed: 0, said: "" };

    const items = pendingOf(loadQueue(this.cfg.dataDir), ["heavy"]).slice(0, 1);
    if (items.length === 0) return { ran: false, reason: "没有 heavy 待办", done: 0, failed: 0, said: "" };

    const item = items[0]!;
    const started = Date.now();
    this.busy = true;
    markItem(this.cfg.dataDir, item.id, "running");
    try {
      const r = await this.reading!.run({ why: item.why.length > 0 ? item.why : item.what, focus: item.done });
      if (!r.ok) {
        markItem(this.cfg.dataDir, item.id, "failed", r.reason);
        return { ran: false, reason: r.reason, done: 0, failed: 1, said: "" };
      }
      const head = (r.said.length > 0 ? r.said : r.summary).replace(/\s+/g, " ").slice(0, 200);
      markItem(this.cfg.dataDir, item.id, "done", head);
      appendJournal(
        this.cfg.dataDir,
        dayKey(started),
        `（${new Date(started).toTimeString().slice(0, 5)} 读了 ${item.id}：${item.what}）${head}`,
      );
      console.log(`[batch] heavy ${item.id} 读完：${r.videosRead} 个视频，${r.learned} 条入库`);
      return { ran: true, reason: `读了 ${item.what}`, done: 1, failed: 0, said: head };
    } catch (err) {
      markItem(this.cfg.dataDir, item.id, "failed", `出错：${err instanceof Error ? err.message : String(err)}`);
      return { ran: false, reason: "heavy 出错", done: 0, failed: 1, said: "" };
    } finally {
      this.busy = false;
      this.lastHeavyAt = Date.now();
      this.heavyToday += 1;
    }
  }

  private buildInstruction(items: QueueItem[]): string {
    const lines = [
      `你有 ${items.length} 件之前想做、还没做的事，按时间排好了：`,
      "",
      ...items.map((i, n) => describeItem(i, n + 1)),
      "",
      "逐条做。",
      "- 能做的就用工具做完，做完用 queue_done 把这个 id 写回去（result 写一句话结果）。",
      "- 做不了的说清为什么（缺工具 / 缺信息 / 不该做），用 queue_done 标 ok:false。",
      "- 不要合并成一句「都做完了」；每条都要有落点。",
      "- 需要看 B 站、读长文档的，别自己硬读——用 queue_add 标成 heavy，留给专门去读的那一轮。",
    ];
    return lines.join("\n");
  }

  async runOnce(): Promise<BatchRunResult> {
    const gate = this.shouldRun();
    if (!gate.ok) return { ran: false, reason: gate.reason, done: 0, failed: 0, said: "" };

    // 有人刚说话 / 走神正在想 / 她刚干完事，就别插进来
    const occupied = this.occupied();
    if (occupied.length > 0) return { ran: false, reason: occupied, done: 0, failed: 0, said: "" };

    const dropped = expireOld(this.cfg.dataDir, 24);
    // 上次批处理跑到一半崩了：把挂在 running 的放回 pending，不然它们永远没人管
    const stuck = loadQueue(this.cfg.dataDir).filter((i) => i.status === "running");
    if (stuck.length > 0) {
      const all = loadQueue(this.cfg.dataDir);
      for (const i of all) if (i.status === "running") i.status = "pending";
      saveQueue(this.cfg.dataDir, all);
    }
    const items = pendingOf(loadQueue(this.cfg.dataDir), ["light", "deep"]).slice(0, 10);
    if (items.length === 0) {
      return { ran: false, reason: "没有可批处理的条目", done: 0, failed: 0, said: "" };
    }

    const started = Date.now();
    this.busy = true;
    for (const i of items) markItem(this.cfg.dataDir, i.id, "running");

    let said = "";
    try {
      said = await this.service.act(this.buildInstruction(items), 8, { toolFilter: batchTools });
    } catch (err) {
      // 整批挂了：全部退回 pending，下次再来
      for (const i of items) markItem(this.cfg.dataDir, i.id, "pending");
      return {
        ran: false,
        reason: `批处理出错：${err instanceof Error ? err.message : String(err)}`,
        done: 0,
        failed: 0,
        said: "",
      };
    } finally {
      this.busy = false;
      this.lastRunAt = Date.now();
    }

    // 她可能只销掉一部分。**没轮到 ≠ 失败**：退回 pending，下批接着做，不涨 tries。
    // （2026-10-28 改的：以前直接标 failed，而 pendingOf 只取 pending，
    //   于是「这一批没轮到它」的条目再也没人管，等于静默丢弃。）
    const after = loadQueue(this.cfg.dataDir);
    let done = 0;
    let failed = 0;
    for (const i of items) {
      const cur = after.find((x) => x.id === i.id);
      if (!cur) continue;
      if (cur.status === "running") {
        markItem(this.cfg.dataDir, i.id, "pending");
      }
      if (cur.status === "done") done += 1;
      if (cur.status === "failed") failed += 1;
    }

    const head = said.trim().replace(/\s+/g, " ").slice(0, 120);
    appendJournal(
      this.cfg.dataDir,
      dayKey(started),
      `（${new Date(started).toTimeString().slice(0, 5)} 批处理 ${items.length} 件：成 ${done} / 没成 ${failed}${
        dropped > 0 ? ` / 过期丢掉 ${dropped}` : ""
      }）${head}`,
    );

    console.log(`[batch] ${items.length} 件 → 成 ${done} / 没成 ${failed}`);
    return { ran: true, reason: `处理了 ${items.length} 件`, done, failed, said };
  }

  /** 定时器：每分钟看一眼，条件满足才真跑 */
  start(everyMinutes = 1): () => void {
    const timer = setInterval(() => {
      const gate = this.shouldRun();
      if (gate.ok) {
        void this.runOnce().catch((err) => {
          console.error(`[batch] 出错：${err instanceof Error ? err.message : String(err)}`);
        });
        return;
      }
      // 批处理不跑的时候，再看一眼有没有 heavy 要读
      const heavy = this.shouldRunHeavy();
      if (heavy.ok) {
        void this.runHeavyOnce().catch((err) => {
          console.error(`[batch] heavy 出错：${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }, Math.max(1, everyMinutes) * 60_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  stats(): { lastRunAt: number } {
    return { lastRunAt: this.lastRunAt };
  }
}
