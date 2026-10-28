import type { BotConfig } from "./config.ts";
import type { BotService } from "./service.ts";
import { appendJournal } from "../tools/journal.ts";
import { dayKey } from "../util.ts";
import {
  describeItem,
  expireOld,
  loadQueue,
  markItem,
  pendingOf,
  queueStats,
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
  private busy = false;
  /** 上一批跑完的时间：防止两条触发条件同时命中时连跑两批 */
  private lastRunAt = 0;

  constructor(cfg: BotConfig, service: BotService) {
    this.cfg = cfg;
    this.service = service;
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
    if (todo >= 10) return { ok: true, reason: `攒够 ${todo} 条` };
    if (s.deep >= 3) return { ok: true, reason: `深任务攒够 ${s.deep} 条` };
    if (s.oldestMinutes >= 30) return { ok: true, reason: `最老的一条等了 ${s.oldestMinutes} 分钟` };
    return { ok: false, reason: `才 ${todo} 条，最老的等了 ${s.oldestMinutes} 分钟` };
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

    // 有人刚说话 / 她刚干完事，就别插进来
    if (this.service.busyRecently(30_000)) {
      return { ran: false, reason: "刚有人在说话", done: 0, failed: 0, said: "" };
    }

    const dropped = expireOld(this.cfg.dataDir, 24);
    const items = pendingOf(loadQueue(this.cfg.dataDir), ["light", "deep"]).slice(0, 10);
    if (items.length === 0) {
      return { ran: false, reason: "没有可批处理的条目", done: 0, failed: 0, said: "" };
    }

    const started = Date.now();
    this.busy = true;
    for (const i of items) markItem(this.cfg.dataDir, i.id, "running");

    let said = "";
    try {
      said = await this.service.act(this.buildInstruction(items), 6, { toolFilter: batchTools });
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

    // 她可能只销掉一部分：还挂在 running 的算失败，留着下次重试
    const after = loadQueue(this.cfg.dataDir);
    let done = 0;
    let failed = 0;
    for (const i of items) {
      const cur = after.find((x) => x.id === i.id);
      if (!cur) continue;
      if (cur.status === "running") {
        markItem(this.cfg.dataDir, i.id, "failed", cur.result || "这一批没轮到它");
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
      if (!gate.ok) return;
      void this.runOnce().catch((err) => {
        console.error(`[batch] 出错：${err instanceof Error ? err.message : String(err)}`);
      });
    }, Math.max(1, everyMinutes) * 60_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  stats(): { lastRunAt: number } {
    return { lastRunAt: this.lastRunAt };
  }
}
