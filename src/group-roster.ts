import type { DatabaseSync } from "node:sqlite";
import type { GroupMember } from "./bot/onebot.ts";

/**
 * 群名册。
 *
 * 为什么单独一张表、而不是直接塞进 people：
 *   people 是「跟她说过话的人」，进 people 就会进【谁是谁】和人物卡；
 *   名册是「这个群里都有谁」，大多数一辈子不开口，塞进去会把 10 行的对照表挤满。
 *   所以：名册只读、只用来回答「群里都有谁」，谁真说了话才走 ensurePerson 进 people。
 */
export function ensureRosterTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      qq_id TEXT NOT NULL,
      card TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member',
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, qq_id)
    );
  `);
}

export interface RosterRow {
  qqId: string;
  name: string;
  role: string;
  syncedAt: number;
}

function displayName(m: { card: string; nickname: string; qqId: string }): string {
  // 群名片优先，但名片经常是表情/单个符号（某某的名片是「🌿」），
  // 那种不算名字，退回昵称；再没有就用号码。
  const card = String(m.card ?? "").trim();
  const looksLikeName = card.length >= 2 && /[\p{L}\p{N}]/u.test(card);
  return (looksLikeName ? card : String(m.nickname ?? "").trim()) || card || m.qqId;
}

/** 整群覆盖写（成员退群就该消失，所以先清后插） */
export function saveGroupMembers(
  db: DatabaseSync,
  groupId: number | string,
  members: GroupMember[],
): { group: string; count: number } {
  ensureRosterTable(db);
  const gid = String(groupId);
  const now = Date.now();
  db.prepare("DELETE FROM group_members WHERE group_id = ?").run(gid);
  const ins = db.prepare(
    "INSERT INTO group_members (group_id, qq_id, card, nickname, role, synced_at) VALUES (?,?,?,?,?,?)",
  );
  for (const m of members) {
    if (!m.qqId) continue;
    ins.run(gid, m.qqId, m.card, m.nickname, m.role || "member", now);
  }
  return { group: gid, count: members.length };
}

export function listGroupMembers(db: DatabaseSync, groupId: number | string): RosterRow[] {
  ensureRosterTable(db);
  const rows = db
    .prepare("SELECT qq_id, card, nickname, role, synced_at FROM group_members WHERE group_id = ? ORDER BY role, nickname, qq_id")
    .all(String(groupId)) as Array<{ qq_id: string; card: string; nickname: string; role: string; synced_at: number }>;
  return rows.map((r) => ({
    qqId: r.qq_id,
    name: displayName({ card: r.card, nickname: r.nickname, qqId: r.qq_id }),
    role: r.role,
    syncedAt: r.synced_at,
  }));
}

/** 群里有没有名册（= 学过没有）。只学一次，之后靠工具按需刷新。 */
export function hasRoster(db: DatabaseSync, groupId: number | string): boolean {
  ensureRosterTable(db);
  const r = db.prepare("SELECT 1 AS x FROM group_members WHERE group_id = ? LIMIT 1").get(String(groupId)) as
    | { x: number }
    | undefined;
  return !!r;
}

/** 最近一次同步时间（0 = 没同步过） */
export function rosterSyncedAt(db: DatabaseSync, groupId: number | string): number {
  ensureRosterTable(db);
  const r = db.prepare("SELECT MAX(synced_at) AS t FROM group_members WHERE group_id = ?").get(String(groupId)) as
    | { t?: number }
    | undefined;
  return Number(r?.t ?? 0);
}

/**
 * 给提示词用的「群情」一行。
 *
 * 群里人不多就把名字都列出来（它要「看到全部群成员」），
 * 人多就只给几个 + 总数，剩下让它去调 group_members 工具查——
 * 40 个名字塞进每轮对话是实打实的 token 开销。
 */
export function rosterLine(db: DatabaseSync, groupId: number | string, spokenNames: string[] = [], maxNames = 40): string {
  const all = listGroupMembers(db, groupId);
  if (all.length === 0) return "";
  const spoken = new Set(spokenNames.map((s) => s.trim()).filter((s) => s.length > 0));
  const names = all.map((m) => m.name);
  const head = `这个群共 ${all.length} 人`;
  const parts: string[] = [];

  if (names.length <= maxNames) {
    parts.push(`${head}：${names.join("、")}。`);
  } else {
    parts.push(`${head}，名册里前 ${maxNames} 个：${names.slice(0, maxNames).join("、")}…（要全部就调 group_members）。`);
  }
  const silent = all.filter((m) => !spoken.has(m.name)).length;
  if (spoken.size > 0 || silent > 0) {
    const said = all.filter((m) => spoken.has(m.name)).map((m) => m.name);
    parts.push(
      said.length > 0
        ? `其中 ${said.length} 个开过口：${said.slice(0, 12).join("、")}${said.length > 12 ? "…" : ""}；其余 ${silent} 个你只见过名字。`
        : `他们在名册里，但都没有开口记录。`,
    );
  }
  return parts.join("");
}
