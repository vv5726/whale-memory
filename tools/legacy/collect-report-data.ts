// 给文档收集所有真实数字，输出 data/memory-report.json
import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { estimateTokens } from "../src/util.ts";
import { loadBotConfig } from "../src/bot/config.ts";

const cfg = loadBotConfig() as unknown as { contextBudgetTokens: number };
const B = Number(cfg.contextBudgetTokens);
const db = new DatabaseSync("data/memory.db");
const one = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);

type Row = { tier: string; title: string; detail: string | null; cause: string | null; effect: string | null; core_fragment: string | null; affect_summary: string | null; key_facts: string };
const rows = db.prepare("SELECT tier, title, detail, cause, effect, core_fragment, affect_summary, key_facts FROM events").all() as Row[];
const facts = (r: Row) => {
  try {
    const v = JSON.parse(r.key_facts || "[]");
    return Array.isArray(v) ? v.map(String).join("") : "";
  } catch {
    return "";
  }
};
const size = (r: Row, tier: string) => {
  const base = estimateTokens(r.title) + estimateTokens(r.core_fragment) + estimateTokens(r.affect_summary) + estimateTokens(facts(r));
  if (tier === "detailed") return base + estimateTokens(r.detail) + estimateTokens(r.cause) + estimateTokens(r.effect);
  if (tier === "compressed") return base + estimateTokens(r.cause) + estimateTokens(r.effect);
  return base;
};
const sample = rows.filter((r) => r.tier === "detailed");
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const per = {
  detailed: avg(sample.map((r) => size(r, "detailed"))),
  compressed: avg(sample.map((r) => size(r, "compressed"))),
  fossil: avg(sample.map((r) => size(r, "fossil"))),
};

const perDay = db.prepare("SELECT day, COUNT(*) c FROM events GROUP BY day ORDER BY day DESC LIMIT 3").all() as Array<{ day: string; c: number }>;
const dayCnt = perDay.reduce((n, r) => n + Number(r.c), 0) / perDay.length;

const budgets = { detailed: B * 0.3, compressed: B * 0.5, fossil: 1_000_000 }; // fossil 按条数
const caps = {
  detailed: Math.floor(budgets.detailed / per.detailed),
  compressed: Math.floor(budgets.compressed / per.compressed),
  fossil: 1_000_000,
};
const days = {
  detailed: budgets.detailed / (dayCnt * per.detailed),
  compressed: budgets.compressed / (dayCnt * per.compressed),
  fossil: 1_000_000 / dayCnt,
};

const tierNow = (t: string) => {
  const r = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(size_tokens),0) s FROM events WHERE tier = ?").get(t) as { c: number; s: number };
  return { count: Number(r.c), tokens: Number(r.s) };
};

const edges = (() => {
  const rows2 = db.prepare("SELECT src, dst, relation FROM edges").all() as Array<{ src: string; dst: string; relation: string }>;
  const tier = new Map<string, number>();
  for (const r of db
    .prepare("SELECT ea.anchor_id AS id, MIN(CASE e.tier WHEN 'detailed' THEN 0 WHEN 'compressed' THEN 1 ELSE 2 END) AS t FROM event_anchors ea JOIN events e ON e.id = ea.event_id WHERE e.archived = 0 GROUP BY ea.anchor_id")
    .all() as Array<{ id: string; t: number }>) {
    tier.set(String(r.id), Number(r.t));
  }
  const c = { hot: 0, warm: 0, cold: 0, coOccur: 0 };
  for (const r of rows2) {
    if (r.relation === "co-occur") {
      c.coOccur += 1;
      continue;
    }
    const k = Math.max(tier.get(r.src) ?? 2, tier.get(r.dst) ?? 2);
    if (k === 0) c.hot += 1;
    else if (k === 1) c.warm += 1;
    else c.cold += 1;
  }
  return c;
})();

const cold = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(LENGTH(COALESCE(raw_detail,''))),0) t FROM cold_archive").get() as { c: number; t: number };

const out = {
  generatedAt: new Date().toISOString(),
  budget: B,
  quotas: { detailed: 0.3, compressed: 0.5 },
  perItem: per,
  caps,
  days,
  totalDays: days.detailed + days.compressed + days.fossil,
  perDay: dayCnt,
  perDaySource: perDay,
  tiers: { detailed: tierNow("detailed"), compressed: tierNow("compressed"), fossil: tierNow("fossil") },
  events: one("SELECT COUNT(*) AS n FROM events"),
  turns: one("SELECT COUNT(*) AS n FROM turns"),
  anchors: one("SELECT COUNT(*) AS n FROM anchors"),
  cold: { count: Number(cold.c), chars: Number(cold.t) },
  edges: { ...edges, total: one("SELECT COUNT(*) AS n FROM edges") },
  dbBytes: statSync("data/memory.db").size,
  kbPerFossil: 0.9,
};

console.log(JSON.stringify(out, null, 2));
const { writeFileSync } = await import("node:fs");
writeFileSync("data/memory-report.json", JSON.stringify(out, null, 2), "utf8");
db.close();
