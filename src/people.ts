import type { DatabaseSync } from "node:sqlite";
import { newId } from "./util.ts";

/**
 * 人。
 *
 * 一条记忆要说清「是谁的事」，得有一个稳定的锚。
 * QQ 号是最稳的：昵称会改，小名会变，号不会。
 * 所以：**QQ 号是身份，昵称/小名/别名是等价称呼**，都指同一个人。
 *
 * 但代词不算——「你」「我」「他」在换一个对话里就指别人了，
 * 把它们当别名会把所有人都连成一个人。
 */

/** 代词黑名单：这些永远不能当别名 */
const PRONOUNS = new Set([
  "你", "我", "他", "她", "它", "您",
  "你们", "我们", "他们", "她们", "它们",
  "对方", "本人", "自己", "大家", "别人", "有人", "某人",
  "这个", "那个", "谁", "你俩", "咱", "咱们",
]);

export function isPronoun(name: string): boolean {
  return PRONOUNS.has(String(name ?? "").trim());
}

export interface Person {
  qqId: string;
  displayName: string;
  anchorId: string;
}

function ensureTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      qq_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      aliases TEXT NOT NULL DEFAULT '[]',
      anchor_id TEXT NOT NULL DEFAULT '',
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
  `);
  // 锚点上记一个「外部身份」（QQ 号），这样人节点和身份是同一个东西
  try {
    db.exec("ALTER TABLE anchors ADD COLUMN external_id TEXT NOT NULL DEFAULT ''");
  } catch {
    // 列已存在
  }
}

/**
 * 有人说话了：确保「这个人」和「他这个锚点」都存在。
 * 昵称随时会改，所以每次都更新一次 display_name。
 */
export function ensurePerson(db: DatabaseSync, qqId: string | number, displayName: string): Person | null {
  const id = String(qqId ?? "").trim();
  if (!id) return null;
  ensureTable(db);

  const now = Date.now();
  // 「QQ123456」这种是占位名，不是真昵称，别拿它覆盖真名
  const rawNick = String(displayName ?? "").trim();
  const nick = /^QQ\d+$/.test(rawNick) ? "" : rawNick; // PLACEHOLDER

  const row = db.prepare("SELECT qq_id, display_name, aliases, anchor_id FROM people WHERE qq_id = ?").get(id) as
    | { qq_id: string; display_name: string; aliases: string; anchor_id: string }
    | undefined;

  if (row) {
    // 昵称变了就记成别名，并把 display_name 更新
    let aliases: string[] = [];
    try {
      aliases = JSON.parse(row.aliases || "[]") as string[];
    } catch {
      aliases = [];
    }
    if (nick && nick !== row.display_name && !aliases.includes(nick) && !isPronoun(nick)) {
      aliases.push(nick);
    }
    db.prepare("UPDATE people SET display_name = ?, aliases = ?, last_seen = ? WHERE qq_id = ?").run(
      nick || row.display_name,
      JSON.stringify(aliases.slice(0, 20)),
      now,
      id,
    );
    return { qqId: id, displayName: nick || row.display_name, anchorId: row.anchor_id };
  }

  // 新人：建锚点（kind=person，external_id=QQ号）。
  // 锚点名有唯一约束——如果这个昵称已经作为锚点存在（以前抽出来过），
  // 就直接接管它，别再建一个同名的。
  const display = nick || `QQ${id}`;
  const existing = db.prepare("SELECT id FROM anchors WHERE name = ?").get(display) as { id: string } | undefined;
  let anchorId: string;
  if (existing) {
    anchorId = existing.id;
    db.prepare("UPDATE anchors SET kind = 'person', external_id = ?, last_seen = ? WHERE id = ?").run(id, now, anchorId);
  } else {
    anchorId = newId("anc");
    db.prepare(
      "INSERT INTO anchors (id, name, kind, salience, hits, first_seen, last_seen, external_id) VALUES (?,?,?,?,?,?,?,?)",
    ).run(anchorId, display, "person", 1.2, 1, now, now, id);
  }

  db.prepare(
    "INSERT INTO people (qq_id, display_name, aliases, anchor_id, first_seen, last_seen) VALUES (?,?,?,?,?,?)",
  ).run(id, nick, "[]", anchorId, now, now);

  return { qqId: id, displayName: nick, anchorId };
}

/** 给某个人加一个等价称呼（昵称、小名、代称）。代词一律拒绝。 */
export function addAlias(db: DatabaseSync, qqId: string | number, alias: string): boolean {
  const id = String(qqId ?? "");
  const name = String(alias ?? "").trim();
  if (!id || !name || isPronoun(name)) return false;
  ensureTable(db);

  const row = db.prepare("SELECT aliases FROM people WHERE qq_id = ?").get(id) as { aliases: string } | undefined;
  if (!row) return false;
  let aliases: string[] = [];
  try {
    aliases = JSON.parse(row.aliases || "[]") as string[];
  } catch {
    aliases = [];
  }
  if (aliases.includes(name)) return true;
  aliases.push(name);
  db.prepare("UPDATE people SET aliases = ?, last_seen = ? WHERE qq_id = ?").run(
    JSON.stringify(aliases.slice(0, 20)),
    Date.now(),
    id,
  );
  return true;
}

/**
 * 把「一个名字」解析成「一个人」。
 * 先查 QQ 号本身，再查显示名，再查别名。
 */
export function resolvePerson(db: DatabaseSync, name: string): Person | null {
  const key = String(name ?? "").trim();
  if (!key || isPronoun(key)) return null;
  ensureTable(db);

  const direct = db
    .prepare("SELECT qq_id, display_name, anchor_id FROM people WHERE qq_id = ? OR display_name = ? LIMIT 1")
    .get(key, key) as { qq_id: string; display_name: string; anchor_id: string } | undefined;
  if (direct) return { qqId: direct.qq_id, displayName: direct.display_name, anchorId: direct.anchor_id };

  const all = db.prepare("SELECT qq_id, display_name, aliases, anchor_id FROM people").all() as Array<{
    qq_id: string;
    display_name: string;
    aliases: string;
    anchor_id: string;
  }>;
  for (const p of all) {
    try {
      const aliases = JSON.parse(p.aliases || "[]") as string[];
      if (aliases.includes(key)) return { qqId: p.qq_id, displayName: p.display_name, anchorId: p.anchor_id };
    } catch {
      // 忽略坏数据
    }
  }
  return null;
}

/** 列出已知的人（给它看的） */
export function listPeople(db: DatabaseSync): Array<{ qqId: string; name: string; aliases: string[] }> {
  ensureTable(db);
  const rows = db.prepare("SELECT qq_id, display_name, aliases FROM people ORDER BY last_seen DESC").all() as Array<{
    qq_id: string;
    display_name: string;
    aliases: string;
  }>;
  return rows.map((r) => {
    let aliases: string[] = [];
    try {
      aliases = JSON.parse(r.aliases || "[]") as string[];
    } catch {
      aliases = [];
    }
    return { qqId: r.qq_id, name: r.display_name, aliases };
  });
}


/**
 * 把一件事挂到一个人身上，并写明**是什么角色**。
 *
 * 一件事里不止一个人：谁说的、说的是谁、只是被提到。
 * 光挂一条边，事后就分不清「林溪说过这话」和「这话是说林溪的」。
 */
export function linkEventPerson(
  db: DatabaseSync,
  eventId: string,
  personAnchorId: string,
  role: "speaker" | "subject" | "mentioned",
  weight = 1,
): void {
  if (!eventId || !personAnchorId) return;
  try {
    db.prepare(
      `INSERT INTO event_anchors (event_id, anchor_id, weight, role) VALUES (?,?,?,?)
       ON CONFLICT(event_id, anchor_id) DO UPDATE SET
         role = CASE
           WHEN event_anchors.role = 'speaker' THEN 'speaker'
           WHEN excluded.role = 'speaker' THEN 'speaker'
           WHEN event_anchors.role = 'subject' THEN 'subject'
           ELSE excluded.role
         END,
         weight = MAX(event_anchors.weight, excluded.weight)`,
    ).run(eventId, personAnchorId, weight, role);
  } catch {
    // 挂不上不影响记忆本身
  }
}

/** 给一个 QQ 号找到（必要时建出）他的人节点 */
export function personAnchorFor(db: DatabaseSync, qqId: string | number, displayName = ""): string | null {
  const p = ensurePerson(db, qqId, displayName);
  return p ? p.anchorId : null;
}
