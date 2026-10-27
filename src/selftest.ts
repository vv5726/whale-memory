import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";
import { DEFAULT_CONFIG, withOverrides } from "./config.ts";
import { openDb } from "./db.ts";
import { ingestTurns } from "./extract.ts";
import { sleep } from "./sleep.ts";
import { recall } from "./recall.ts";
import { ensureAnchor, linkIdentity } from "./anchors.ts";
import { dereference } from "./cold.ts";
import { readDataset, readProbes, runFullEval, seedFromFile } from "./eval.ts";
import { dayKeyToTs } from "./util.ts";
import type { MemoryConfig, Tier } from "./types.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TMP = join(ROOT, "data", "selftest.db");
const SEEDS = join(ROOT, "data", "seed-anchors.json");
const DATASET = join(ROOT, "eval", "dataset.jsonl");
const PROBES = join(ROOT, "eval", "probes.json");

const TIER_RANK: Record<Tier, number> = { detailed: 0, compressed: 1, fossil: 2 };

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}

function freshDb(path: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${path}${suffix}`);
    } catch {
      // 不存在就算了
    }
  }
  const db = openDb(path);
  seedFromFile(db, SEEDS);
  return db;
}

/** 按天重放整个数据集，一天睡一觉 */
function replayAll(db: ReturnType<typeof freshDb>, cfg: MemoryConfig): void {
  const turns = readDataset(DATASET);
  const byDay = new Map<string, typeof turns>();
  for (const t of turns) {
    if (!byDay.has(t.day)) byDay.set(t.day, []);
    byDay.get(t.day)!.push(t);
  }
  for (const day of [...byDay.keys()].sort()) {
    ingestTurns(db, byDay.get(day)!);
    sleep(db, cfg, { nowTs: dayKeyToTs(day) + 8 * 3600_000 });
  }
}

function main(): void {
  const cfg = withOverrides(DEFAULT_CONFIG, { contextBudgetTokens: 900 });

  // 召回类的检查（第 6、7 条）需要候选记忆**还在上下文里**。
  // 900 的预算会把绝大部分压进化石层，而化石层不进召回——那正是第 3、5 条在测的事，
  // 不该让召回检查跟着陪葬。所以这两条单独用一个大一点的预算。
  const cfgRoomy = withOverrides(cfg, { contextBudgetTokens: 5000 });

  console.log("1. 睡眠是幂等的（重复跑不会把记忆压坏）");
  {
    const db = freshDb(TMP);
    const turns = readDataset(DATASET).filter((t) => t.day <= "2025-01-20");
    const byDay = new Map<string, typeof turns>();
    for (const t of turns) {
      if (!byDay.has(t.day)) byDay.set(t.day, []);
      byDay.get(t.day)!.push(t);
    }
    for (const [day, rows] of byDay) {
      ingestTurns(db, rows);
      sleep(db, cfg, { nowTs: dayKeyToTs(day) + 8 * 3600_000 });
    }
    const snapshot = () =>
      db
        .prepare("SELECT id, tier, size_tokens FROM events ORDER BY id")
        .all()
        .map((r) => `${r.id}:${r.tier}:${r.size_tokens}`)
        .join("|");
    const before = snapshot();
    sleep(db, cfg, { nowTs: dayKeyToTs("2025-01-21") });
    check("没有新对话时再睡一觉，存储结构不变", before === snapshot(), "重复整合改变了已有事件");
    db.close();
  }

  console.log("2. 降级是单向的（不会「忘完了又想起来」）");
  {
    const db = freshDb(TMP);
    const turns = readDataset(DATASET);
    const byDay = new Map<string, typeof turns>();
    for (const t of turns) {
      if (!byDay.has(t.day)) byDay.set(t.day, []);
      byDay.get(t.day)!.push(t);
    }
    const worst = new Map<string, number>();
    let upgraded = 0;
    for (const day of [...byDay.keys()].sort()) {
      ingestTurns(db, byDay.get(day)!);
      sleep(db, cfg, { nowTs: dayKeyToTs(day) + 8 * 3600_000 });
      for (const r of db.prepare("SELECT id, tier FROM events").all()) {
        const id = String(r.id);
        const rank = TIER_RANK[String(r.tier) as Tier];
        const prev = worst.get(id);
        if (prev !== undefined && rank < prev) upgraded += 1;
        worst.set(id, rank);
      }
    }
    check("任何事件都没有被重新升级", upgraded === 0, `${upgraded} 个事件从更旧的层回到了更清晰的层`);
    db.close();
  }

  console.log("3. 上下文预算不被突破");
  {
    const db = freshDb(TMP);
    replayAll(db, cfg);
    const used = Number(
      db.prepare("SELECT COALESCE(SUM(size_tokens),0) AS t FROM events WHERE archived = 0").get()?.t ?? 0,
    );
    // 化石层 archived=1：不进上下文、也不占 token 预算（2026-10-27 起按条数封顶）。
    // 所以这里只能量 archived=0 的那部分，上限是 detailed + compressed 两档之和。
    const cap = Math.round(cfg.contextBudgetTokens * (cfg.detailedQuota + cfg.compressedQuota));
    check(`上下文占用 ${used} ≤ 上限 ${cap}（化石层不进上下文）`, used <= cap, "降级/合并没能把水位压下来");
    db.close();
  }

  console.log("4. 钉住的三道闸：规则命中 + 额度 + 有效期");
  {
    const db = freshDb(TMP);
    // 只重放到约定那天：钉住有 180 天有效期，三年后早该自动解除了（确实会）
    const turns = readDataset(DATASET).filter((t) => t.day <= "2026-02-15");
    const byDay = new Map<string, typeof turns>();
    for (const t of turns) {
      if (!byDay.has(t.day)) byDay.set(t.day, []);
      byDay.get(t.day)!.push(t);
    }
    for (const day of [...byDay.keys()].sort()) {
      ingestTurns(db, byDay.get(day)!);
      sleep(db, cfg, { nowTs: dayKeyToTs(day) + 8 * 3600_000 });
    }
    const pinned = db.prepare("SELECT id, tier, title FROM events WHERE pinned = 1").all();
    check("存在被机械规则识别出的约定类记忆", pinned.length > 0, "pinPatterns 一条都没命中");
    check(
      "约定类记忆全部仍是 detailed",
      pinned.every((p) => String(p.tier) === "detailed"),
      `实际：${pinned.map((p) => String(p.tier)).join(",")}`,
    );
    check("云南那个约定还在", pinned.some((p) => String(p.title).includes("云南")));

    const pinnedTotal = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE pinned = 1").get()?.c ?? 0);
    check(`钉住总数 ${pinnedTotal} ≤ 上限 ${cfg.pinnedLimit}`, pinnedTotal <= cfg.pinnedLimit);

    const one = pinned[0];
    if (one) {
      db.prepare("UPDATE events SET pin_expires_at = ? WHERE id = ?").run(Date.now() - 86_400_000, String(one.id));
      const st = sleep(db, cfg, { nowTs: Date.now() });
      const still = db.prepare("SELECT pinned FROM events WHERE id = ?").get(String(one.id));
      check(`过期钉住被自动解除（${st.expiredPins} 条）`, Number(still?.pinned ?? 0) === 0, "过了约定日期仍然钉着");
    }
    db.close();
  }

  console.log("5. 遗忘可逆：冷存储有稳定地址，deref 能取回原文");
  {
    const db = freshDb(TMP);
    replayAll(db, cfg);
    const fossils = db.prepare("SELECT id FROM events WHERE tier = 'fossil'").all();
    check("出现了化石层", fossils.length > 0);

    const withAddress = db.prepare("SELECT event_id, address, raw_detail FROM cold_archive WHERE address IS NOT NULL").all();
    check(`底片都有地址（${withAddress.length} 条）`, withAddress.length > 0, "冷存储里没有带地址的记录");

    const sample = withAddress[0];
    if (sample) {
      const got = dereference(db, String(sample.address));
      check("按地址能取回原文", Boolean(got && got.rawDetail === String(sample.raw_detail)));
      check("地址是 cold:// 形式", String(sample.address).startsWith("cold://"));
      const grew = db.prepare("SELECT COUNT(*) AS c FROM cold_archive").get();
      check(`冷存储是独立的一份（${Number(grew?.c ?? 0)} 条），不进上下文`, withAddress.length > 0);
    }
    db.close();
  }

  console.log("6. 概率抽样可复现（同一会话同一天不会自相矛盾）");
  {
    const db = freshDb(TMP);
    replayAll(db, cfgRoomy);
    const nowTs = dayKeyToTs("2026-10-12");
    const a = recall(db, cfgRoomy, "王建国那两千块钱还了吗", { nowTs, sessionId: "s1" });
    const b = recall(db, cfgRoomy, "王建国那两千块钱还了吗", { nowTs, sessionId: "s1" });
    const c = recall(db, cfgRoomy, "王建国那两千块钱还了吗", { nowTs, sessionId: "s2" });
    check("同一会话两次抽样结果一致", a.affective?.event.id === b.affective?.event.id);
    check(
      "事实通道完全确定",
      JSON.stringify(a.factual.map((f) => f.event.id)) === JSON.stringify(b.factual.map((f) => f.event.id)),
    );
    // 先确认池子不是空的：池子空的时候 affective 一定是 null，
    // 那种情况下报"抽样跳出了概率表"是误导（真正的原因是候选被压没了）。
    check("候选池非空（有能被想起来的记忆）", c.probabilityTable.length > 0, "候选池是空的，能不能抽中无从谈起");
    const poolIds = new Set(c.probabilityTable.map((t) => t.eventId));
    check("换会话后抽到的仍在候选池内", Boolean(c.affective && poolIds.has(c.affective.event.id)), "抽样跳出了概率表");
    db.close();
  }

  console.log("7. 同一性合并：100% 关联的两个锚点并成一个节点");
  {
    const db = freshDb(TMP);
    replayAll(db, cfgRoomy);
    const before = Number(db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c ?? 0);
    const wjg = db.prepare("SELECT id FROM anchors WHERE name = '王建国'").get();
    check("找到王建国锚点", Boolean(wjg));
    if (wjg) {
      const boss = ensureAnchor(db, "王总", "person", Date.now());
      linkIdentity(db, String(wjg.id), boss, 1.0, Date.now());
      const st = sleep(db, cfgRoomy, { nowTs: Date.now() });
      const after = Number(db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c ?? 0);
      check(`锚点 ${before} → ${after}（合并 ${st.mergedAnchors} 个）`, after === before, "same-as 1.0 的锚点没有被合并");
      const alias = db.prepare("SELECT anchor_id FROM anchor_aliases WHERE alias = '王总'").get();
      const wjgNow = db.prepare("SELECT id FROM anchors WHERE name = '王建国'").get();
      check("「王总」变成了王建国的别名", Boolean(alias && wjgNow && String(alias.anchor_id) === String(wjgNow.id)));
      const r = recall(db, cfgRoomy, "王总说的那些事", { nowTs: Date.now() });
      check("用「王总」仍能连到王建国的记忆", r.factual.length > 0, `种子 ${r.seeds.length}｜kept ${r.factual.length}`);
    }
    db.close();
  }

  console.log("8. 强制叫醒：中途打断，状态完整，下次接着跑");
  {
    const db = freshDb(TMP);
    const turns = readDataset(DATASET).filter((t) => t.day === "2024-06-18");
    ingestTurns(db, turns);
    let n = 0;
    const st = sleep(db, cfg, {
      nowTs: dayKeyToTs("2024-06-18") + 8 * 3600_000,
      shouldWake: () => {
        n += 1;
        return n > 2;
      },
    });
    check(`停在某个步骤（${st.interruptedAtStep ?? "没停"}）`, Boolean(st.interruptedAtStep), "shouldWake 没有生效");
    const status = db.prepare("SELECT status FROM sleep_runs WHERE id = ?").get(st.runId);
    check("状态记为 interrupted", String(status?.status) === "interrupted");
    const resumed = sleep(db, cfg, { nowTs: dayKeyToTs("2024-06-18") + 8 * 3600_000 });
    check("再睡一次能跑完", resumed.interruptedAtStep === undefined);
    db.close();
  }

  console.log("9. 预算越大，忘得越少（预算曲线单调）");
  {
    const recallAt = (budget: number) => {
      const result = runFullEval({
        dbPath: join(ROOT, "data", "selftest-curve.db"),
        datasetPath: DATASET,
        probesPath: PROBES,
        seedsPath: SEEDS,
        cfg: withOverrides(DEFAULT_CONFIG, { contextBudgetTokens: budget }),
      });
      return result.report.hitRate;
    };
    const curve = [650, 1200, 2400].map((b) => ({ b, r: recallAt(b) }));
    const monotone = curve.every((x, i) => i === 0 || x.r >= curve[i - 1].r - 1e-9);
    check(
      `曲线 ${curve.map((x) => `${x.b}:${(x.r * 100).toFixed(0)}%`).join(" → ")} 单调不降`,
      monotone,
      "预算变大召回率反而下降，说明打分或压缩有 bug",
    );
  }

  console.log("10. 重复强化：同一件事再提一次，不新建而是变强");
  {
    const db = freshDb(TMP);
    const line = { day: "2026-01-05", role: "user" as const, text: "王建国说下周三之前把借我的两千块钱还上。" };
    ingestTurns(db, [line]);
    sleep(db, cfg, { nowTs: dayKeyToTs(line.day) + 8 * 3600_000 });

    const first = db.prepare("SELECT id, mentions, strength, key_facts FROM events").all();
    check("第一次只建一条", first.length === 1, `实际 ${first.length} 条`);
    check(`关键事实被提取（${String(first[0]?.key_facts ?? "[]")}）`, String(first[0]?.key_facts ?? "[]").includes("两千"));

    // 一个月后同一件事又提了一次
    ingestTurns(db, [{ day: "2026-02-05", role: "user", text: "王建国说下周三之前把借我的两千块钱还上。" }]);
    sleep(db, cfg, { nowTs: dayKeyToTs("2026-02-05") + 8 * 3600_000 });

    const after = db.prepare("SELECT id, mentions, strength FROM events").all();
    check("没有重复新建，仍然只有一条", after.length === 1, `实际 ${after.length} 条`);
    check(`提起次数变成 2（实际 ${Number(after[0]?.mentions ?? 0)}）`, Number(after[0]?.mentions ?? 0) === 2);
    check(`强度被抬高（${Number(after[0]?.strength ?? 0).toFixed(2)} > 1）`, Number(after[0]?.strength ?? 0) > 1);

    // 预算压到极小，逼它降级到化石层，关键事实必须还在
    const tight = withOverrides(cfg, { contextBudgetTokens: 40 });
    sleep(db, tight, { nowTs: dayKeyToTs("2027-06-05") });
    const fossil = db.prepare("SELECT tier, key_facts, core_fragment FROM events WHERE id = ?").get(String(first[0]?.id));
    check(`被压到化石层（${String(fossil?.tier)}）`, String(fossil?.tier) === "fossil");
    check(
      `化石层仍然留着关键事实（${String(fossil?.key_facts ?? "[]")}）`,
      String(fossil?.key_facts ?? "[]").includes("两千"),
      "关键事实跟着正文一起被压掉了",
    );
    db.close();
  }

  console.log("");
  if (failed > 0) {
    console.log(`✗ ${failed} 项失败`);
    process.exitCode = 1;
  } else {
    console.log("✓ 全部通过");
  }
}

main();
