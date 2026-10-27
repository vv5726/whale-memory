import type { DatabaseSync } from "node:sqlite";
import { lastChatTarget, matchChatTarget, recentChatTargets, type ChatTarget } from "./last-chat.ts";

/**
 * 决定「这句话到底发到哪」。
 *
 * 优先级：
 *   1. 名字/号 → people 表或 anchors 里认得出这个人
 *        · can_dm = 1（好友）→ 私聊
 *        · can_dm = 0        → 去群里找（下面）
 *   2. 群怎么选：正在聊的群 > 他所在群里人数最少的 > 没有
 *   3. 认不出 / 没渠道 → 不发（返回 none），让她回头问主人
 * 关键：点名失败时**绝不**回落到"最近那个会话"——那会把话发错人。
 */
export interface SendTarget {
  kind: "private" | "group" | "none";
  id?: number;
  label: string;
  why: string;
  at?: number;
}

function findPerson(db: DatabaseSync, spoken: string): { qq: string; name: string; canDm: boolean } | null {
  const t = spoken.trim();
  if (!t) return null;
  const num = (t.match(/\d{5,}/) ?? [])[0] ?? "";
  if (num) {
    const row = db.prepare("SELECT name, external_id FROM anchors WHERE external_id = ? LIMIT 1").get(num) as
      | { name: string; external_id: string }
      | undefined;
    const canDm = db.prepare("SELECT can_dm FROM anchors WHERE external_id = ? LIMIT 1").get(num) as { can_dm?: number } | undefined;
    if (row) return { qq: num, name: row.name, canDm: Number(canDm?.can_dm ?? 0) === 1 };
  }
  const like = `%${t}%`;
  const a = db
    .prepare("SELECT name, external_id, can_dm FROM anchors WHERE (name = ? OR name LIKE ?) AND external_id != '' LIMIT 1")
    .get(t, like) as { name: string; external_id: string; can_dm?: number } | undefined;
  if (a?.external_id) return { qq: a.external_id, name: a.name, canDm: Number(a.can_dm ?? 0) === 1 };
  const p = db
    .prepare("SELECT display_name, qq_id, anchor_id FROM people WHERE display_name = ? OR aliases LIKE ? LIMIT 1")
    .get(t, like) as { display_name: string; qq_id: string; anchor_id: string } | undefined;
  if (p?.qq_id) {
    const c = db.prepare("SELECT can_dm FROM anchors WHERE external_id = ? LIMIT 1").get(p.qq_id) as { can_dm?: number } | undefined;
    return { qq: p.qq_id, name: p.display_name, canDm: Number(c?.can_dm ?? 0) === 1 };
  }
  return null;
}

/**
 * 点名的数字正好是群号吗？
 *
 * 只认名册里真有的群（`group_members` 就是机器人真在的群），
 * 而且排在「找人」后面——先人后群，免得把 QQ 号当成群号。
 */
function findGroup(db: DatabaseSync, spoken: string): { id: number; n: number } | null {
  for (const raw of String(spoken ?? "").match(/\d{6,}/g) ?? []) {
    const gid = Number(raw);
    if (!Number.isFinite(gid)) continue;
    const row = db.prepare("SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?").get(String(gid)) as
      | { n?: number }
      | undefined;
    const n = Number(row?.n ?? 0);
    if (n > 0) return { id: gid, n };
  }
  return null;
}

export function resolveSendTarget(
  spoken: string,
  db: DatabaseSync,
  ownerId: number,
  opts: { recent?: ChatTarget[] } = {},
): SendTarget {
  const recent = opts.recent ?? recentChatTargets();
  const text = String(spoken ?? "").trim();

  // 没点名：发最近那个会话；都没有才发主人
  if (text.length === 0) {
    const last = lastChatTarget();
    if (last) {
      return last.isGroup && last.groupId
        ? { kind: "group", id: last.groupId, label: `群 ${last.groupId}`, why: "没点名，发最近在聊的群" }
        : { kind: "private", id: last.userId, label: `${last.userName || last.userId}（私聊）`, why: "没点名，发最近聊的人" };
    }
    return { kind: "private", id: ownerId, label: "主人私聊", why: "没有最近会话" };
  }

  // 点名命中最近会话
  const inRecent = matchChatTarget(text, recent);
  if (inRecent) {
    return inRecent.isGroup && inRecent.groupId
      ? { kind: "group", id: inRecent.groupId, label: `群 ${inRecent.groupId}`, why: "点名 + 在最近会话里" }
      : { kind: "private", id: inRecent.userId, label: `${inRecent.userName}（私聊）`, why: "点名 + 在最近会话里" };
  }

  // 查这个人
  const person = findPerson(db, text);
  if (!person) {
    // 不是人 → 可能是点名了某个群号（先人后群，所以放在这里）
    const g = findGroup(db, text);
    if (g) return { kind: "group", id: g.id, label: `群 ${g.id}`, why: `点名了群号（名册 ${g.n} 人）` };
    return { kind: "none", label: text, why: `认不出「${text}」是谁（没有号、也不在最近会话里）` };
  }
  if (person.canDm) {
    return { kind: "private", id: Number(person.qq), label: `${person.name}（私聊）`, why: "是好友，可以直接私聊" };
  }

  // 不是好友 → 找群
  const groups = db
    .prepare("SELECT group_id, COUNT(*) AS n FROM group_members GROUP BY group_id")
    .all() as Array<{ group_id: number; n: number }>;
  const hisGroups: Array<{ group_id: number; n: number }> = [];
  for (const g of groups) {
    const hit = db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND qq_id = ?").get(g.group_id, person.qq);
    if (hit) hisGroups.push(g);
  }
  if (hisGroups.length === 0) {
    return { kind: "none", label: person.name, why: `${person.name} 不是好友，也不在任何已知的群里` };
  }
  // 正在聊的群优先
  const active = recent.filter((r) => r.isGroup && r.groupId && hisGroups.some((g) => g.group_id === r.groupId));
  if (active.length > 0) {
    const g = active[0].groupId!;
    return { kind: "group", id: g, label: `群 ${g}（@${person.name}）`, why: "他不在好友里，但你正在这个群聊" };
  }
  // 否则人数最少的群（越少越不打扰）
  hisGroups.sort((a, b) => a.n - b.n);
  const pick = hisGroups[0];
  return {
    kind: "group",
    id: pick.group_id,
    label: `群 ${pick.group_id}（@${person.name}）`,
    why: `他不是好友，选了他所在的人数最少的群（${pick.n} 人）`,
  };
}
