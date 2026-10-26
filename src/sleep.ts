import type { DatabaseSync } from "node:sqlite";
import type { MemoryConfig, SleepStats, Tier } from "./types.ts";
import { contractIdentityAnchors, decayAnchors, decayEdges, loadAnchorIndex } from "./anchors.ts";
import { consolidateTiers } from "./compress.ts";
import { rowToEvent, tierTotals } from "./db.ts";
import { expirePins, extractEvents } from "./extract.ts";
import { extractDayWithLlm } from "./llm/extract.ts";
import { createAdapter, type LlmAdapter } from "./llm/adapter.ts";
import { dominantMood } from "./recall.ts";
import { dayKey, newId, periodLabel } from "./util.ts";

export interface SleepOptions {
  nowTs?: number;
  /**
   * 每一步之间调一次。返回 true 就立刻起床（当前这一步已经做完，状态是完整的）。
   * 「强行叫醒」不做优雅收尾：没跑完的步骤留到下次睡眠继续，反正每一步都幂等。
   */
  shouldWake?: () => boolean;
  /** 跳过启发式抽取（模型已经抽过了） */
  skipExtract?: boolean;
}

/**
 * 睡眠 = 一个可重跑的批处理状态机。
 *
 * 人类是「睡一觉才把今天的事整理好」，所以抽取、压缩、降级、锚点合并全在这里做，
 * 聊天过程中绝不整理记忆。每一步都从当前状态推导，中途被叫醒或崩掉都可以原地重跑。
 */
export function sleep(db: DatabaseSync, cfg: MemoryConfig, opts: SleepOptions = {}): SleepStats {
  const startedAt = Date.now();
  const nowTs = opts.nowTs ?? startedAt;
  const runId = newId("sleep");
  db.prepare("INSERT INTO sleep_runs(id, started_at, status, stats) VALUES(?,?,?,?)").run(
    runId,
    startedAt,
    "running",
    null,
  );

  let turnsIngested = 0;
  let eventsExtracted = 0;
  let anchorsTouched = 0;
  let edgesFormed = 0;
  let deferredPins = 0;
  let mergedAnchors = 0;
  let expiredPins = 0;
  let degraded = { detailedToCompressed: 0, compressedToFossil: 0, archived: 0, mergedFossils: 0 };
  let edgesDecayed = 0;
  let mood = { valence: 0, arousal: 0, label: "平静" };

  const steps: Array<{ name: string; run: () => void }> = [
    {
      name: "extract",
      run: () => {
        if (opts.skipExtract) return;
        const index = loadAnchorIndex(db);
        const extracted = extractEvents(db, cfg, index);
        turnsIngested = extracted.turns;
        eventsExtracted = extracted.events;
        anchorsTouched = extracted.anchors;
        edgesFormed = extracted.edges;
        deferredPins = extracted.deferredPins;
      },
    },
    {
      name: "contract-identities",
      run: () => {
        // 100% 关联的锚点在这里真正并成一个节点，越早越好，后面所有计算都省事
        mergedAnchors = contractIdentityAnchors(db, cfg.identityMergeThreshold);

        // 共享记忆下：把「谁说的」从对话带到事件上。
        // 没有这一步，朋友的妈妈和你的妈妈在检索时就分不开了。
        // ① 有来源对话的，直接从对话上取（最准）
        db.exec(`
          UPDATE events
          SET speaker_id = COALESCE((
            SELECT t.speaker_id FROM turns t WHERE t.id = events.source_turn_id
          ), '')
          WHERE (speaker_id IS NULL OR speaker_id = '')
            AND source_turn_id IS NOT NULL
            AND source_turn_id <> ''
            AND EXISTS (SELECT 1 FROM turns t2 WHERE t2.id = events.source_turn_id)
        `);

        // ② 没有来源对话的（LLM 抽取出来的都是这种），用「那天是谁在说话」兜底。
        //    之前只做了 ①，所以绝大部分记忆的说话人一直空着。
        // 之前这里按「那天最后说话的人」一锅贴，导致群里的发言全算到主人头上。
        // 只在「当天只有一个说话人」时才敢这么补，多人说话的一律留空，
        // 交给后面的内容匹配去归属。
        db.exec(`
          UPDATE events
          SET speaker_id = COALESCE((
            SELECT t.speaker_id FROM turns t
            WHERE t.day = events.day AND t.speaker_id <> ''
            GROUP BY t.day
            HAVING COUNT(DISTINCT t.speaker_id) = 1
            LIMIT 1
          ), '')
          WHERE (speaker_id IS NULL OR speaker_id = '')
            AND (SELECT COUNT(DISTINCT t2.speaker_id) FROM turns t2 WHERE t2.day = events.day AND t2.speaker_id <> '') = 1
        `);
      },
    },
    {
      name: "compress",
      run: () => {
        degraded = consolidateTiers(db, cfg, nowTs);
      },
    },
    {
      name: "expire-pins",
      run: () => {
        expiredPins = expirePins(db, nowTs);
      },
    },
    {
      name: "decay-anchors",
      run: () => {
        edgesDecayed = decayAnchors(db, cfg.salienceDecay) + decayEdges(db, 7, 0.05, nowTs);
      },
    },
    {
      name: "mood",
      run: () => {
        for (const row of db.prepare("SELECT id, ts FROM events WHERE period_label IS NULL").all()) {
          db.prepare("UPDATE events SET period_label = ? WHERE id = ?").run(
            periodLabel(Number(row.ts), nowTs),
            String(row.id),
          );
        }
        const recent = db
          .prepare("SELECT * FROM events ORDER BY ts DESC, created_at DESC LIMIT 7")
          .all()
          .map((r) => rowToEvent(r as Record<string, unknown>));
        mood = dominantMood(recent);
        db.prepare(
          "INSERT INTO mood_state(id, valence, arousal, label, note, updated_at) VALUES('current',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET valence = excluded.valence, arousal = excluded.arousal, label = excluded.label, note = excluded.note, updated_at = excluded.updated_at",
        ).run(mood.valence, mood.arousal, mood.label, `由 ${recent.length} 条近期记忆加权`, nowTs);
      },
    },
  ];

  let interruptedAtStep: string | undefined;

  try {
    for (const step of steps) {
      if (opts.shouldWake?.()) {
        interruptedAtStep = step.name;
        break;
      }
      step.run();
    }
  } catch (err) {
    db.prepare("UPDATE sleep_runs SET finished_at = ?, status = ?, error = ? WHERE id = ?").run(
      Date.now(),
      "failed",
      String(err instanceof Error ? (err.stack ?? err.message) : err),
      runId,
    );
    throw err;
  }

  const totals = tierTotals(db);
  const stats: SleepStats = {
    runId,
    turnsIngested,
    eventsExtracted,
    anchorsTouched,
    edgesFormed,
    degradedDetailed2Compressed: degraded.detailedToCompressed,
    degradedCompressed2Fossil: degraded.compressedToFossil,
    archived: degraded.archived,
    mergedFossils: degraded.mergedFossils,
    mergedAnchors,
    expiredPins,
    deferredPins,
    edgesDecayed,
    totalTokens: Object.values(totals).reduce((a, t) => a + t.tokens, 0),
    tiers: {
      detailed: totals.detailed,
      compressed: totals.compressed,
      fossil: totals.fossil,
    } as Record<Tier, { count: number; tokens: number }>,
    mood,
    elapsedMs: Date.now() - startedAt,
    interruptedAtStep,
  };

  db.prepare("UPDATE sleep_runs SET finished_at = ?, status = ?, stats = ? WHERE id = ?").run(
    Date.now(),
    interruptedAtStep ? "interrupted" : "done",
    JSON.stringify(stats),
    runId,
  );
  // 每次整理完导出一份人可读的快照
  try {
    const file = exportMemoryMarkdown(db, cfg.dataDir ?? "data", nowTs);
    console.log(`[sleep] 记忆快照：${file}`);
  } catch {
    // 导不出来不影响整理
  }

  return stats;
}

export function pendingTurns(db: DatabaseSync): number {
  const r = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get();
  return Number(r?.c ?? 0);
}

/**
 * 先让模型抽一遍，再跑原来的睡眠步骤。
 *
 * 关键设计：
 *  - 模型抽过的日子把 turn 标记成已处理，于是后面同步的启发式抽取只会看到
 *    「模型失败的那些天」——自动兜底，不用写额外的分支。
 *  - 模型输出落库即冻结，重跑睡眠不会重抽，幂等性不受模型随机性破坏。
 */
export async function sleepAsync(
  db: DatabaseSync,
  cfg: MemoryConfig,
  opts: SleepOptions = {},
  adapter?: LlmAdapter,
): Promise<SleepStats> {
  if (cfg.extractor !== "llm") return sleep(db, cfg, opts);

  const engine = adapter ?? createAdapter(cfg);
  const pending = db
    .prepare("SELECT id, day, role, text, speaker_id FROM turns WHERE processed = 0 ORDER BY seq ASC")
    .all();

  const byDay = new Map<string, Array<{ id: string; role: string; text: string }>>();
  for (const row of pending) {
    const day = String(row.day);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push({ id: String(row.id), role: String(row.role), text: String(row.text) });
  }

  const report = {
    days: 0,
    inserted: 0,
    rejected: 0,
    failed: 0,
    newAnchors: 0,
    reinforced: 0,
    frozen: 0,
    fallbackDays: [] as string[],
    elapsedMs: 0,
  };

  const llmStartedAt = Date.now();
  for (const [day, turns] of byDay) {
    // 只记本人的话：助手自己的回复不该变成记忆（否则会产出「对方总结今天」这种条目）
    const mine = turns.filter((t) => t.role === "user");
    if (mine.length === 0) {
      db.prepare("UPDATE turns SET processed = 1 WHERE day = ?").run(day);
      continue;
    }
    const index = loadAnchorIndex(db);

    // 一次喂一整天（几百轮）模型挑不动，只会给出三五条。
    // 切成 60 轮一段，每段自己划事件的起止，加起来才是完整的一天。
    const CHUNK = 60;
    const names = (() => {
      try {
        const row = db.prepare("SELECT display_name, qq_id FROM people ORDER BY last_seen DESC LIMIT 1").get() as
          | { display_name?: string; qq_id?: string }
          | undefined;
        return { user: row?.qq_id ? `${row.display_name || "vv"}（${row.qq_id}）` : "vv", assistant: "凝" };
      } catch {
        return { user: "vv", assistant: "凝" };
      }
    })();

    let result = await extractDayWithLlm(db, cfg, index, engine, day, mine.slice(0, CHUNK), names);
    for (let i = CHUNK; i < mine.length; i += CHUNK) {
      const part = await extractDayWithLlm(db, cfg, index, engine, day, mine.slice(i, i + CHUNK), names);
      result = {
        ...result,
        inserted: result.inserted + part.inserted,
        anchors: result.anchors + part.anchors,
        edges: result.edges + part.edges,
      };
    }
    report.days += 1;
    report.inserted += result.inserted;
    report.rejected += result.rejected;
    report.newAnchors += result.newAnchors;
    report.reinforced += result.reinforced;
    if (result.frozen) report.frozen += 1;
    if (result.failed) {
      report.failed += 1;
      report.fallbackDays.push(day);
    }
  }
  report.elapsedMs = Date.now() - llmStartedAt;

  // 失败的日期 turn 没被标记，同步的启发式抽取会自动接手
  const stats = sleep(db, cfg, opts);
  stats.llm = report;
  stats.elapsedMs += report.elapsedMs;
  // 每次整理完导出一份人可读的快照
  try {
    const file = exportMemoryMarkdown(db, cfg.dataDir ?? "data", nowTs);
    console.log(`[sleep] 记忆快照：${file}`);
  } catch {
    // 导不出来不影响整理
  }

  return stats;
}

export function today(db: DatabaseSync): string {
  const r = db.prepare("SELECT MAX(day) AS d FROM turns").get();
  return String(r?.d ?? dayKey(Date.now()));
}

export function lastSleepRun(db: DatabaseSync): { id: string; status: string; startedAt: number } | null {
  const r = db.prepare("SELECT id, status, started_at FROM sleep_runs ORDER BY started_at DESC LIMIT 1").get();
  return r ? { id: String(r.id), status: String(r.status), startedAt: Number(r.started_at) } : null;
}

