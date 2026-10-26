import type { DatabaseSync } from "node:sqlite";
import { newId } from "./util.ts";

/**
 * 请示机制。
 *
 * 有两件事不能自己决定：
 *  - 花钱（真钱出去了退不回来）
 *  - 对外发东西（评论、弹幕、动态——发出去所有人都看得见）
 *
 * 但她也不是要「什么都不做」，所以做法不是禁止，而是**先问**：
 * 工具不直接执行，而是挂一笔待批，同时发一条消息给本人。
 * 本人回「准 1234」就办，「不 1234」就撤。
 */
export type ApprovalKind = "like" | "comment" | "danmaku" | "dynamic" | "purchase";

export interface Approval {
  id: string;
  shortId: string;
  kind: ApprovalKind;
  bvid: string;
  payload: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: number;
  decidedAt: number | null;
}

export function ensureApprovalTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      short_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      bvid TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, created_at);
  `);
}

/** 挂一笔待批，返回给人看的那句话 */
export function createApproval(
  db: DatabaseSync,
  input: { kind: ApprovalKind; bvid?: string; payload?: string; what: string },
): { shortId: string; message: string } {
  ensureApprovalTable(db);
  // 简短好回的编号：四位数，撞了就再摇
  let shortId = "";
  for (let i = 0; i < 20; i += 1) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    const exists = db
      .prepare("SELECT 1 FROM approvals WHERE short_id = ? AND status = 'pending'")
      .get(candidate);
    if (!exists) {
      shortId = candidate;
      break;
    }
  }
  if (shortId.length === 0) shortId = String(Date.now()).slice(-4);

  db.prepare(
    "INSERT INTO approvals (id, short_id, kind, bvid, payload, status, created_at) VALUES (?,?,?,?,?, 'pending', ?)",
  ).run(newId("ap"), shortId, input.kind, input.bvid ?? "", input.payload ?? "", Date.now());

  const label =
    input.kind === "like"
      ? "点个赞"
      : input.kind === "comment"
        ? "发条评论"
        : input.kind === "danmaku"
          ? "发条弹幕"
          : input.kind === "dynamic"
            ? "发条动态"
            : "花钱";

  return {
    shortId,
    message: `想${label}：${input.what}\n\n行的话回「准 ${shortId}」，不行回「不 ${shortId}」。`,
  };
}

/** 本人回复「准 1234 / 不 1234」 */
export function resolveApproval(
  db: DatabaseSync,
  shortId: string,
  approve: boolean,
): Approval | null {
  ensureApprovalTable(db);
  const row = db
    .prepare("SELECT * FROM approvals WHERE short_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
    .get(shortId) as Record<string, unknown> | undefined;
  if (!row) return null;

  db.prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?").run(
    approve ? "approved" : "rejected",
    Date.now(),
    String(row.id),
  );

  return {
    id: String(row.id),
    shortId: String(row.short_id),
    kind: String(row.kind) as ApprovalKind,
    bvid: String(row.bvid ?? ""),
    payload: String(row.payload ?? ""),
    status: approve ? "approved" : "rejected",
    createdAt: Number(row.created_at),
    decidedAt: Date.now(),
  };
}

/** 从一句回复里认出是不是在答复某笔待批 */
export function parseApprovalReply(text: string): { shortId: string; approve: boolean } | null {
  const m = /^\s*(准|同意|行|可以|好|不|别|不要|拒绝)\s*(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const approve = ["准", "同意", "行", "可以", "好"].includes(m[1]!);
  return { shortId: m[2]!, approve };
}
