// 预算按用途分门别类。
//
// 数据来自 data/logs/llm-usage.log —— 每调一次模型记一行（toolchat 里写的）。
// daily_cost 只有总数，算不出「钱花在走神还是对话上」，这个脚本补那一层。
//
// 用法：node tools/usage-report.ts [2026-10-28]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOG = join("data", "logs", "llm-usage.log");
const day = process.argv[2] ?? new Date().toLocaleDateString("sv-SE");

interface Row {
  tag: string;
  in: number;
  out: number;
  hit: number;
  rounds: number;
}

const rows: Row[] = [];
if (existsSync(LOG)) {
  for (const line of readFileSync(LOG, "utf8").split("\n")) {
    const m = /^(\d{4}-\d{2}-\d{2}) \d\d:\d\d:\d\d\|([^|]+)\|in=(\d+)\|out=(\d+)\|hit=(\d+)\|rounds=(\d+)$/.exec(line.trim());
    if (!m) continue;
    if (m[1] !== day) continue;
    rows.push({
      tag: m[2]!,
      in: Number(m[3]),
      out: Number(m[4]),
      hit: Number(m[5]),
      rounds: Number(m[6]),
    });
  }
}

if (rows.length === 0) {
  console.log(`没有 ${day} 的调用记录（${LOG}）。`);
  console.log("今天才开始记：跑一天再看。");
  process.exit(0);
}

/** 输入 ¥0.5/M（缓存命中按 1/10）、输出 ¥8/M —— 和 cost.ts 的默认一致 */
const PRICE_IN = 0.5 / 1_000_000;
const PRICE_HIT = PRICE_IN / 10;
const PRICE_OUT = 8 / 1_000_000;

const byTag = new Map<string, { calls: number; in: number; out: number; hit: number; cost: number; rounds: number }>();
for (const r of rows) {
  const cur = byTag.get(r.tag) ?? { calls: 0, in: 0, out: 0, hit: 0, cost: 0, rounds: 0 };
  const miss = Math.max(0, r.in - r.hit);
  cur.calls += 1;
  cur.in += r.in;
  cur.out += r.out;
  cur.hit += r.hit;
  cur.rounds += r.rounds;
  cur.cost += r.hit * PRICE_HIT + miss * PRICE_IN + r.out * PRICE_OUT;
  byTag.set(r.tag, cur);
}

const total = [...byTag.values()].reduce(
  (a, v) => ({ calls: a.calls + v.calls, in: a.in + v.in, out: a.out + v.out, cost: a.cost + v.cost, rounds: a.rounds + v.rounds }),
  { calls: 0, in: 0, out: 0, cost: 0, rounds: 0 },
);

const pad = (s: string | number, n: number): string => String(s).padStart(n);
const NAMES: Record<string, string> = {
  think: "走神（想事）",
  batch: "批处理（做队列）",
  learn: "学习（读完简报）",
  reader: "阅读员（看 B 站）",
  reply: "对话",
  act: "其它 act",
};

console.log(`\n${day}　共 ${total.calls} 次调用，输入 ${(total.in / 1e6).toFixed(2)}M，¥${total.cost.toFixed(2)}\n`);
console.log("用途                 次数   输入(M)  平均/次   花费(¥)   占比");
console.log("─".repeat(64));
for (const [tag, v] of [...byTag.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
  const pct = total.cost > 0 ? (v.cost / total.cost) * 100 : 0;
  console.log(
    `${(NAMES[tag] ?? tag).padEnd(18)} ${pad(v.calls, 5)} ${pad((v.in / 1e6).toFixed(2), 8)} ${pad(Math.round(v.in / v.calls / 1000) + "k", 8)} ${pad(v.cost.toFixed(2), 8)} ${pad(pct.toFixed(0) + "%", 7)}`,
  );
}
console.log("─".repeat(64));
console.log(`${"合计".padEnd(18)} ${pad(total.calls, 5)} ${pad((total.in / 1e6).toFixed(2), 8)} ${pad(Math.round(total.in / total.calls / 1000) + "k", 8)} ${pad(total.cost.toFixed(2), 8)} ${pad("100%", 7)}`);
console.log(`\n工具调用轮次合计 ${total.rounds}（每轮都重发一遍提示词，这是钱的来源）`);
