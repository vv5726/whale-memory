import { randomBytes } from "node:crypto";
import { reindexEventFts } from "./db.ts";
import { dayKey, newId, periodLabel } from "./util.ts";
import type { DatabaseSync } from "node:sqlite";

/**
 * 计划表。
 *
 * 一条计划必须同时有四样东西（少一样就不让建）：
 *   1. 要干什么（what）
 *   2. 为什么要干（why）
 *   3. 定计划的时间（created_at，自动）
 *   4. 提醒间隔（interval_minutes）
 * 外加：跟一个锚点关联（anchor），这样她想起来、检索、走神都能碰到它。
 *
 * 提醒 ≠ 必须做：到点了只把计划推到她眼前；她可以完成（done）、
 * 也可以再改一次时间（update remindAt / interval）。
 */

export interface Plan {
  id: string;
  what: string;
  why: string;
  createdAt: number;
  remindAt: number;
  intervalMinutes: number;
  anchorId: string;
  anchorName: string;
  status: "active" | "done";
  doneAt: number;
  lastRemindedAt: number;
  remindCount: number;
}

interface Row {
  id: string;
  what: string;
  why: string;
  created_at: number;
  remind_at: number;
  interval_minutes: number;
  anchor_id: string;
  anchor_name: string;
  status: string;
  done_at: number;
  last_reminded_at: number;
  remind_count: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  what TEXT NOT NULL,
  why TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  remind_at INTEGER NOT NULL,
  interval_minutes INTEGER NOT NULL,
  anchor_id TEXT NOT NULL DEFAULT '',
  anchor_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  done_at INTEGER NOT NULL DEFAULT 0,
  last_reminded_at INTEGER NOT NULL DEFAULT 0,
  remind_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_plans_due ON plans(status, remind_at);
`;

export function ensurePlanTable(db: DatabaseSync): void {
  db.exec(SCHEMA);
}

function toPlan(r: Row): Plan {
  return {
    id: r.id,
    what: r.what,
    why: r.why,
    createdAt: r.created_at,
    remindAt: r.remind_at,
    intervalMinutes: r.interval_minutes,
    anchorId: r.anchor_id,
    anchorName: r.anchor_name,
    status: r.status === "done" ? "done" : "active",
    doneAt: r.done_at,
    lastRemindedAt: r.last_reminded_at,
    remindCount: r.remind_count,
  };
}

/** 锚点：有就复用，没有就建一个（计划要能挂到记忆网上） */
function resolveAnchor(db: DatabaseSync, name: string): { id: string; name: string } {
  const clean = String(name ?? "").trim();
  if (clean.length === 0) return { id: "", name: "" };
  const hit = db.prepare("SELECT id, name FROM anchors WHERE name = ? LIMIT 1").get(clean) as
    | { id: string; name: string }
    | undefined;
  if (hit) return hit;
  const now = Date.now();
  const id = `anc_plan_${randomBytes(6).toString("hex")}`;
  try {
    db.prepare(
      "INSERT INTO anchors (id, name, kind, salience, hits, first_seen, last_seen, external_id) VALUES (?, ?, 'event', 1.0, 0, ?, ?, '')",
    ).run(id, clean, now, now);
  } catch {
    // 并发下可能被别的写入抢先，再读一次
    const again = db.prepare("SELECT id, name FROM anchors WHERE name = ? LIMIT 1").get(clean) as
      | { id: string; name: string }
      | undefined;
    if (again) return again;
  }
  return { id, name: clean };
}

export function addPlan(
  db: DatabaseSync,
  input: {
    what: string;
    why: string;
    intervalMinutes?: number;
    /** 想按小时说就传这个（跟 intervalMinutes 二选一，优先小时） */
    intervalHours?: number;
    anchorName?: string;
    anchor?: string;
    /** 绝对时间（毫秒） */
    remindAt?: number;
    /** 相对：多少分钟后提醒 */
    remindInMinutes?: number;
    /** 相对：多少小时后提醒 */
    remindInHours?: number;
  },
): { ok: boolean; text: string; plan?: Plan } {
  ensurePlanTable(db);
  const what = String(input.what ?? "").trim();
  const why = String(input.why ?? "").trim();
  const interval = Math.round(
    Number(input.intervalHours) > 0 ? Number(input.intervalHours) * 60 : Number(input.intervalMinutes),
  );
  // 兼容两种写法：anchorName / anchor（工具层用前者，测试和脚本爱用后者）
  const anchorName = String(input.anchorName ?? (input as { anchor?: string }).anchor ?? "").trim();
  const missing: string[] = [];
  if (what.length < 2) missing.push("要干什么（what）");
  if (why.length < 2) missing.push("为什么要干（why）");
  if (!Number.isFinite(interval) || interval <= 0) missing.push("提醒间隔（intervalMinutes 或 intervalHours）");
  if (anchorName.length === 0) missing.push("关联的锚点（anchor）");
  if (missing.length > 0) return { ok: false, text: `这四项必须都有：${missing.join("、")}` };

  const now = Date.now();
  // 三种说法都行：绝对时间 / 多少分钟后 / 多少小时后；都没给就按间隔
  const absolute = Number(input.remindAt);
  const inMinutes = Number(input.remindInMinutes);
  const inHours = Number(input.remindInHours);
  const remindAt =
    Number.isFinite(absolute) && absolute > 0
      ? Math.round(absolute)
      : Number.isFinite(inHours) && inHours > 0
        ? now + Math.round(inHours * 3_600_000)
        : Number.isFinite(inMinutes) && inMinutes > 0
          ? now + Math.round(inMinutes * 60_000)
          : now + interval * 60_000;
  const anchor = resolveAnchor(db, anchorName);
  const id = `plan_${randomBytes(6).toString("hex")}`;
  db.prepare(
    `INSERT INTO plans (id, what, why, created_at, remind_at, interval_minutes, anchor_id, anchor_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, what, why, now, remindAt, Math.max(1, Math.min(60 * 24 * 30, interval)), anchor.id, anchor.name);
  const plan = getPlan(db, id)!;
  return { ok: true, text: `记下了：${fmtPlan(plan)}`, plan };
}

export function getPlan(db: DatabaseSync, id: string): Plan | null {
  ensurePlanTable(db);
  const r = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Row | undefined;
  return r ? toPlan(r) : null;
}

export function listPlans(db: DatabaseSync, opts: { status?: "active" | "done" | "all"; anchor?: string } = {}): Plan[] {
  ensurePlanTable(db);
  const status = opts.status ?? "active";
  const where: string[] = [];
  const args: unknown[] = [];
  if (status !== "all") {
    where.push("status = ?");
    args.push(status);
  }
  if (opts.anchor) {
    where.push("anchor_name = ?");
    args.push(opts.anchor);
  }
  const sql = `SELECT * FROM plans ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY status, remind_at ASC`;
  return (db.prepare(sql).all(...args) as unknown as Row[]).map(toPlan);
}

export function duePlans(db: DatabaseSync, now = Date.now()): Plan[] {
  ensurePlanTable(db);
  return (
    db.prepare("SELECT * FROM plans WHERE status = 'active' AND remind_at <= ? ORDER BY remind_at ASC").all(now) as unknown as Row[]
  ).map(toPlan);
}

/** 到点后：记一次提醒，并把下一次提醒往后推一个间隔 */
export function markReminded(db: DatabaseSync, id: string, now = Date.now()): Plan | null {
  const plan = getPlan(db, id);
  if (!plan) return null;
  const next = now + plan.intervalMinutes * 60_000;
  db.prepare("UPDATE plans SET last_reminded_at = ?, remind_count = remind_count + 1, remind_at = ? WHERE id = ?").run(
    now,
    next,
    id,
  );
  return getPlan(db, id);
}

export function updatePlan(
  db: DatabaseSync,
  input: {
    id: string;
    what?: string;
    why?: string;
    intervalMinutes?: number;
    intervalHours?: number;
    remindAt?: number;
    remindInMinutes?: number;
    remindInHours?: number;
    anchorName?: string;
    status?: "active" | "done";
  },
): { ok: boolean; text: string; plan?: Plan } {
  const plan = getPlan(db, input.id);
  if (!plan) return { ok: false, text: `没有这个计划：${input.id}` };

  const sets: string[] = [];
  const args: unknown[] = [];
  const push = (col: string, v: unknown): void => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (input.what !== undefined) {
    if (String(input.what).trim().length < 2) return { ok: false, text: "要干什么太短了" };
    push("what", String(input.what).trim());
  }
  if (input.why !== undefined) {
    if (String(input.why).trim().length < 2) return { ok: false, text: "原因太短了" };
    push("why", String(input.why).trim());
  }
  if (input.intervalHours !== undefined || input.intervalMinutes !== undefined) {
    const v =
      input.intervalHours !== undefined
        ? Math.round(Number(input.intervalHours) * 60)
        : Math.round(Number(input.intervalMinutes));
    if (!Number.isFinite(v) || v <= 0) return { ok: false, text: "提醒间隔要是正数（分钟或小时）" };
    push("interval_minutes", Math.max(1, Math.min(60 * 24 * 30, v)));
  }
  if (input.remindAt !== undefined || input.remindInMinutes !== undefined || input.remindInHours !== undefined) {
    const abs = Number(input.remindAt);
    const mins = Number(input.remindInMinutes);
    const hrs = Number(input.remindInHours);
    const v =
      Number.isFinite(abs) && abs > 0
        ? Math.round(abs)
        : Number.isFinite(hrs) && hrs > 0
          ? Date.now() + Math.round(hrs * 3_600_000)
          : Number.isFinite(mins) && mins > 0
            ? Date.now() + Math.round(mins * 60_000)
            : NaN;
    if (!Number.isFinite(v) || v <= 0) return { ok: false, text: "提醒时间不对（给 remindAt / remindInHours / remindInMinutes 之一）" };
    push("remind_at", v);
  }
  if (input.anchorName !== undefined) {
    const a = resolveAnchor(db, input.anchorName);
    push("anchor_id", a.id);
    push("anchor_name", a.name);
  }
  if (input.status !== undefined) {
    push("status", input.status);
    if (input.status === "done") push("done_at", Date.now());
    if (input.status === "active") push("done_at", 0);
  }
  if (sets.length === 0) return { ok: false, text: "没有要改的字段" };
  args.push(input.id);
  db.prepare(`UPDATE plans SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  const after = getPlan(db, input.id)!;
  return { ok: true, text: `改好了：${fmtPlan(after)}`, plan: after };
}

export function deletePlan(db: DatabaseSync, id: string): { ok: boolean; text: string } {
  ensurePlanTable(db);
  const plan = getPlan(db, id);
  if (!plan) return { ok: false, text: `没有这个计划：${id}` };
  db.prepare("DELETE FROM plans WHERE id = ?").run(id);
  return { ok: true, text: `删掉了：${plan.what}` };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function fmtTime(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 分钟数 → 人话（90 → 「1.5 小时」，1440 → 「1 天」） */
export function describeInterval(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m % 1440 === 0) return `${m / 1440} 天`;
  if (m % 60 === 0) return `${m / 60} 小时`;
  if (m >= 60) return `${(m / 60).toFixed(1).replace(/\.0$/, "")} 小时`;
  return `${m} 分钟`;
}

export function fmtPlan(p: Plan): string {
  const leftMin = Math.round((p.remindAt - Date.now()) / 60_000);
  const when = leftMin <= 0 ? "到点了" : leftMin < 60 ? `${leftMin} 分钟后` : `${Math.round(leftMin / 60)} 小时后`;
  return `[${p.what}] 原因：${p.why}｜定于 ${fmtTime(p.createdAt)}｜每 ${describeInterval(p.intervalMinutes)}提醒一次｜下次 ${fmtTime(p.remindAt)}（${when}）｜锚点：${p.anchorName || "无"}｜${p.status === "done" ? "已完成" : "进行中"}`;
}

/** 到点的计划拼成提示词里的一段 */
export function planPromptBlock(plans: Plan[]): string {
  if (plans.length === 0) return "";
  const lines = ["【计划到点了】", "这些是你之前自己定下的，时间到了："];
  for (const p of plans) {
    lines.push(`- ${p.what}｜原因：${p.why}｜定于 ${fmtTime(p.createdAt)}｜每 ${describeInterval(p.intervalMinutes)}提醒`);
  }
  lines.push(
    "",
    "提醒不等于必须做：可以做（做完 plan_done），也可以再改一次时间（plan_update 传 remindAt 或 intervalMinutes），",
    "也可以直接删掉（plan_delete）——想清楚再来，别只是被推着走。",
  );
  return lines.join("\n");
}


/**
 * 做完的计划 → 写成一条记忆事件，并挂到它关联的锚点上。
 *
 * 为什么要有这个：她不想删掉做完的计划，但计划表本身检索不到；
 * 变成事件之后，它就能被 memory_recent / 锚点网络检索到，
 * 以后想到「记忆系统」这个锚点，会连带想起「我什么时候做过什么、为什么做」。
 */
export function archivePlanToMemory(
  db: DatabaseSync,
  plan: Plan,
  now = Date.now(),
  memoryValue = 6,
): { ok: boolean; text: string; eventId?: string } {
  if (!plan || plan.status !== "done") return { ok: false, text: "只有已完成的计划才能归档" };
  const id = newId("ev");
  const title = `完成：${plan.what}`.slice(0, 60);
  const detail = [
    `计划「${plan.what}」已经做完。`,
    `为什么做：${plan.why}`,
    `定计划：${fmtTime(plan.createdAt)}｜提醒间隔 ${plan.intervalMinutes} 分钟｜提醒过 ${plan.remindCount} 次`,
    plan.doneAt ? `完成于：${fmtTime(plan.doneAt)}` : "",
    plan.anchorName ? `关联锚点：${plan.anchorName}` : "",
  ]
    .filter((x) => x.length > 0)
    .join("\n");
  try {
    db.prepare(
      `INSERT INTO events (id, day, ts, period_label, tier, stage, title, detail, etype, status, memory_value, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'detailed', 'extracted', ?, ?, '计划', '已完成', ?, 'project', ?, ?)`,
    ).run(id, dayKey(now), now, periodLabel(now, now), title, detail, Math.max(0, Math.min(10, Math.round(memoryValue))), now, now);
    if (plan.anchorId) {
      db.prepare("INSERT OR REPLACE INTO event_anchors (event_id, anchor_id, weight, role) VALUES (?, ?, 1.0, 'subject')").run(
        id,
        plan.anchorId,
      );
    }
    try {
      reindexEventFts(db, id);
    } catch {
      // 全文索引补不上不影响记忆本身
    }
    return { ok: true, text: `已写进记忆：${title}`, eventId: id };
  } catch (err) {
    return { ok: false, text: `写记忆失败：${err instanceof Error ? err.message : String(err)}` };
  }
}
