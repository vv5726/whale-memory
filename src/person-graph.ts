import type { DatabaseSync } from "node:sqlite";
import { newId } from "./util.ts";
import { isPronoun } from "./people.ts";

/**
 * 人 → 锚点 → 内容 的绑定层。
 *
 * 为什么要有这一层：库里的「同一个人」曾经散成好几份——
 *   · people 表 6 行，anchor_id 有 5 个指向**根本不存在**的锚点（悬空）
 *   · 同一个人有两份锚点：名字锚点（某某、主人）和号码锚点（10000002、10000001）
 *   · event_anchors.role 全是 mentioned（4949 条），speaker **一条都没有**
 *     —— linkEventPerson() 写好了但从来没被调用过
 *
 * 结果就是：它知道「10000002 = 某某」，但不知道某某说过什么、什么事是关于他的。
 *
 * 这里的做法是**不合并、不搬数据**：挑一个「挂事最多」的锚点当主锚点，
 * 其他名字做成别名指过来，然后把「谁说的」写成 role=speaker。
 * 幂等，可以每次睡完都跑一遍。
 */

interface PeopleRow {
  qq_id: string;
  display_name: string;
  aliases: string;
  anchor_id: string;
}

function countLinks(db: DatabaseSync, anchorId: string): number {
  const r = db.prepare("SELECT COUNT(*) AS c FROM event_anchors WHERE anchor_id = ?").get(anchorId) as { c?: number } | undefined;
  return Number(r?.c ?? 0);
}

function anchorExists(db: DatabaseSync, id: string): boolean {
  return !!db.prepare("SELECT 1 AS x FROM anchors WHERE id = ?").get(id);
}

function setAlias(db: DatabaseSync, alias: string, anchorId: string): boolean {
  const name = String(alias ?? "").trim();
  if (name.length === 0) return false;
  const before = db.prepare("SELECT anchor_id FROM anchor_aliases WHERE alias = ?").get(name) as
    | { anchor_id: string }
    | undefined;
  if (before?.anchor_id === anchorId) return false;
  db.prepare(
    `INSERT INTO anchor_aliases (alias, anchor_id, confidence) VALUES (?,?,1)
     ON CONFLICT(alias) DO UPDATE SET anchor_id = excluded.anchor_id, confidence = 1`,
  ).run(name, anchorId);
  return true;
}

/** 某个人现在的「主锚点」（people 表为准；没有就 null） */
export function primaryAnchorOf(db: DatabaseSync, qqId: string | number): string | null {
  const id = String(qqId ?? "").trim();
  if (!id) return null;
  const row = db.prepare("SELECT anchor_id FROM people WHERE qq_id = ?").get(id) as { anchor_id: string } | undefined;
  return row?.anchor_id && anchorExists(db, row.anchor_id) ? row.anchor_id : null;
}

/** 这个人的所有锚点：主锚点 + 通过别名指过来的名字锚点 */
export function anchorsOf(db: DatabaseSync, qqId: string | number): string[] {
  const primary = primaryAnchorOf(db, qqId);
  if (!primary) return [];
  const out = new Set<string>([primary]);
  const rows = db.prepare("SELECT alias FROM anchor_aliases WHERE anchor_id = ?").all(primary) as Array<{ alias: string }>;
  for (const r of rows) {
    const a = db.prepare("SELECT id FROM anchors WHERE name = ?").get(r.alias) as { id: string } | undefined;
    if (a) out.add(a.id);
  }
  return [...out];
}

/**
 * 把 people 表修好（幂等）：
 *  · 挑主锚点 = 候选人里「挂着的事最多」的那个（保住已有的 850 / 1219 条关联）
 *  · 给主锚点写上 external_id
 *  · 其他名字/号码做成别名指过来
 *  · people.anchor_id 指向主锚点（修掉悬空引用）
 */
export function linkPeopleToAnchors(db: DatabaseSync): {
  people: number;
  created: number;
  aliasAdded: number;
  fixed: number;
} {
  const people = db.prepare("SELECT qq_id, display_name, aliases, anchor_id FROM people").all() as PeopleRow[];
  let created = 0;
  let aliasAdded = 0;
  let fixed = 0;

  for (const p of people) {
    const qq = String(p.qq_id).trim();
    if (!qq) continue;
    let aliases: string[] = [];
    try {
      aliases = JSON.parse(p.aliases || "[]") as string[];
    } catch {
      aliases = [];
    }
    const names = [p.display_name, qq, ...aliases].map((s) => String(s ?? "").trim()).filter((s) => s.length > 0);

    // 候选人：名字能对上的、external_id 对上的、原来 anchor_id 指向的
    const cand = new Set<string>();
    for (const n of names) {
      const r = db.prepare("SELECT id FROM anchors WHERE name = ?").get(n) as { id: string } | undefined;
      if (r) cand.add(r.id);
    }
    const byExternal = db.prepare("SELECT id FROM anchors WHERE external_id = ?").all(qq) as Array<{ id: string }>;
    for (const r of byExternal) cand.add(r.id);
    if (p.anchor_id && anchorExists(db, p.anchor_id)) cand.add(p.anchor_id);

    let primary: string;
    if (cand.size === 0) {
      // 一个人都没有：建一个（用主名，没有主名就用号码）
      const name = String(p.display_name ?? "").trim() || qq;
      const dup = db.prepare("SELECT id FROM anchors WHERE name = ?").get(name) as { id: string } | undefined;
      if (dup) {
        primary = dup.id;
      } else {
        primary = newId("anc");
        const now = Date.now();
        db.prepare(
          "INSERT INTO anchors (id, name, kind, salience, hits, first_seen, last_seen, external_id) VALUES (?,?,?,?,?,?,?,?)",
        ).run(primary, name, "person", 1.2, 1, now, now, qq);
        created++;
      }
    } else {
      // 挂事最多的那个当主锚点：保住已有的事件关联，不搬数据
      primary = [...cand].sort((a, b) => countLinks(db, b) - countLinks(db, a) || (a < b ? -1 : 1))[0]!;
    }

    db.prepare("UPDATE anchors SET kind = 'person', external_id = ? WHERE id = ?").run(qq, primary);
    if (p.anchor_id !== primary) fixed++;
    db.prepare("UPDATE people SET anchor_id = ? WHERE qq_id = ?").run(primary, qq);

    for (const n of names) if (setAlias(db, n, primary)) aliasAdded++;
  }

  // 名字本身就是号码的锚点：external_id 就该是这个号码。
  // 她自己的号（10000003）没有 people 行，靠这条才能被认成「一个人」。
  const numeric = db
    .prepare("SELECT id, name FROM anchors WHERE kind = 'person' AND (external_id IS NULL OR external_id = '')")
    .all() as Array<{ id: string; name: string }>;
  for (const a of numeric) {
    if (/^\d{5,}$/.test(a.name)) db.prepare("UPDATE anchors SET external_id = ? WHERE id = ?").run(a.name, a.id);
  }

  return { people: people.length, created, aliasAdded, fixed };
}

/**
 * 把「她自己也当成一个人」写进 people。
 *
 * 之前 people 里没有 10000003：她的 12 条发言（speaker_id=10000003）、
 * 6 条自称（speaker_id=凝）、1 条「对方」全都没法归属——
 * 这不是脏数据，是同一个人用不同的叫法在说话，缺的是映射。
 */
export function ensureSelfPerson(db: DatabaseSync, selfQq: string | number, selfName = "凝"): string | null {
  const qq = String(selfQq ?? "").trim();
  if (!qq) return null;
  const name = String(selfName ?? "").trim() || "凝";

  const existing = db.prepare("SELECT anchor_id FROM people WHERE qq_id = ?").get(qq) as
    | { anchor_id: string }
    | undefined;
  if (existing?.anchor_id && anchorExists(db, existing.anchor_id)) {
    db.prepare("UPDATE people SET display_name = CASE WHEN display_name = '' THEN ? ELSE display_name END WHERE qq_id = ?").run(name, qq);
    return existing.anchor_id;
  }

  // 优先接管「名字就是号码」的那个锚点（它身上挂着 12 条发言）
  const byNumber = db.prepare("SELECT id FROM anchors WHERE external_id = ? OR name = ?").get(qq, qq) as
    | { id: string }
    | undefined;
  const byName = db.prepare("SELECT id FROM anchors WHERE name = ?").get(name) as { id: string } | undefined;
  const anchorId = byNumber?.id ?? byName?.id ?? newId("anc");
  if (!byNumber && !byName) {
    const now = Date.now();
    db.prepare(
      "INSERT INTO anchors (id, name, kind, salience, hits, first_seen, last_seen, external_id) VALUES (?,?,?,?,?,?,?,?)",
    ).run(anchorId, name, "person", 1.2, 1, now, now, qq);
  }
  db.prepare("UPDATE anchors SET kind = 'person', external_id = ? WHERE id = ?").run(qq, anchorId);

  if (existing) {
    db.prepare("UPDATE people SET anchor_id = ?, display_name = CASE WHEN display_name = '' THEN ? ELSE display_name END WHERE qq_id = ?").run(anchorId, name, qq);
  } else {
    const now = Date.now();
    db.prepare("INSERT INTO people (qq_id, display_name, aliases, anchor_id, first_seen, last_seen) VALUES (?,?,?,?,?,?)").run(
      qq,
      name,
      "[]",
      anchorId,
      now,
      now,
    );
  }
  return anchorId;
}

/**
 * 「谁说的」这个字段可能是：号码（10000001）、名字（对方 / 某某）、自称（凝）、代词（他）。
 * 号码和名字都该归属到人；代词归属不了，如实丢掉，别猜。
 */
export function resolveSpeakerAnchor(db: DatabaseSync, raw: string | number): { anchorId: string | null; kind: "qq" | "name" | "self" | "pronoun" | "unknown" } {
  const s = String(raw ?? "").trim();
  if (!s) return { anchorId: null, kind: "unknown" };

  if (/^\d{5,}$/.test(s)) {
    const byPeople = primaryAnchorOf(db, s);
    if (byPeople) return { anchorId: byPeople, kind: "qq" };
    const a = db.prepare("SELECT id FROM anchors WHERE external_id = ?").get(s) as { id: string } | undefined;
    return { anchorId: a?.id ?? null, kind: "qq" };
  }

  // 代词：他 / 她 / 你 / 我 / 咱们 —— 这种真的指不出是谁
  if (isPronoun(s)) return { anchorId: null, kind: "pronoun" };

  // 名字 / 自称：先看主名，再看别名
  const p = db.prepare("SELECT qq_id FROM people WHERE display_name = ?").get(s) as { qq_id: string } | undefined;
  if (p) return { anchorId: primaryAnchorOf(db, p.qq_id), kind: "name" };
  const alias = db.prepare("SELECT anchor_id FROM anchor_aliases WHERE alias = ?").get(s) as { anchor_id: string } | undefined;
  if (alias) return { anchorId: alias.anchor_id, kind: "name" };
  return { anchorId: null, kind: "unknown" };
}

/**
 * 代词/认不出的说话人，靠事件自己的证据倒回具体的人。
 *
 * 例子：库里 11 条 `speaker_id = "他"`——那是抽取提示词当年把没标说话人的消息
 * 打上「他」，模型照抄进了 evidence.speaker。但它们的 `evidence.msg_id` 指向
 * `turns` 里真实的发言，11 条全都能倒回具体的人（10 条 对方、1 条某某）。
 * 这不是猜，是证据链。
 */
export function resolveViaEvidence(
  db: DatabaseSync,
  evidenceJson: string | null | undefined,
): { anchorId: string; qq: string } | null {
  let ev: Array<{ msg_id?: string }> = [];
  try {
    const parsed = JSON.parse(String(evidenceJson ?? "[]"));
    ev = Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }
  for (const e of ev) {
    const msgId = String(e?.msg_id ?? "");
    if (!msgId) continue;
    const t = db.prepare("SELECT speaker_id FROM turns WHERE id = ?").get(msgId) as { speaker_id?: string } | undefined;
    const raw = String(t?.speaker_id ?? "").trim();
    if (!raw) continue;
    const who = resolveSpeakerAnchor(db, raw);
    if (who.anchorId) return { anchorId: who.anchorId, qq: /^\d{5,}$/.test(raw) ? raw : "" };
  }
  return null;
}

/**
 * 把「谁说的」写进 event_anchors.role（幂等）。
 *
 * 来源：events.speaker_id；号码、名字、自称都归到人；
 * 代词（他）先靠事件自己的 evidence 倒回真人（证据链），倒不回去的才算真归属不了。
 * 倒回来的时候顺手把 events.speaker_id 也修成 QQ 号——检索的 speakerFactor 在用它。
 */
export function syncSpeakerRoles(db: DatabaseSync): {
  events: number;
  links: number;
  pronouns: number;
  unresolved: number;
  recovered: number;
} {
  const rows = db
    .prepare(
      "SELECT id, speaker_id, evidence FROM events WHERE speaker_id IS NOT NULL AND speaker_id <> '' AND COALESCE(archived, 0) = 0",
    )
    .all() as Array<{ id: string; speaker_id: string; evidence: string | null }>;

  const upsert = db.prepare(
    `INSERT INTO event_anchors (event_id, anchor_id, weight, role) VALUES (?,?,1,'speaker')
     ON CONFLICT(event_id, anchor_id) DO UPDATE SET
       role = CASE WHEN event_anchors.role = 'speaker' THEN 'speaker' ELSE 'speaker' END,
       weight = MAX(event_anchors.weight, 1)`,
  );
  const repair = db.prepare("UPDATE events SET speaker_id = ? WHERE id = ?");

  let links = 0;
  let pronouns = 0;
  let unresolved = 0;
  let recovered = 0;
  for (const r of rows) {
    let anchor = resolveSpeakerAnchor(db, r.speaker_id).anchorId;
    if (!anchor) {
      const via = resolveViaEvidence(db, r.evidence);
      if (via) {
        anchor = via.anchorId;
        recovered++;
        // 顺手把 speaker_id 修成号码：检索的 speakerFactor 在用它
        if (via.qq) repair.run(via.qq, r.id);
      }
    }
    if (!anchor) {
      if (isPronoun(String(r.speaker_id))) pronouns++;
      else unresolved++;
      continue;
    }
    upsert.run(r.id, anchor);
    links++;
  }
  return { events: rows.length, links, pronouns, unresolved, recovered };
}

export interface PersonCard {
  qqId: string;
  name: string;
  aliases: string[];
  /** 他说过的事（role=speaker） */
  spoke: string[];
  /** 关于他的事（role=subject/mentioned） */
  about: string[];
}

function brief(s: string, max = 42): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 给某个 QQ 号拿一张「他是谁 + 他说过什么」的卡；没这个人就 null */
export function personCard(db: DatabaseSync, qqId: string | number, limit = 2): PersonCard | null {
  const qq = String(qqId ?? "").trim();
  if (!qq) return null;
  const row = db.prepare("SELECT display_name, aliases FROM people WHERE qq_id = ?").get(qq) as
    | { display_name: string; aliases: string }
    | undefined;
  // 没有 people 行也可能是这段人生里的人（比如她自己的号）：按 external_id 兜底认锚点
  const anchors = row ? anchorsOf(db, qq) : (() => {
    const a = db.prepare("SELECT id FROM anchors WHERE external_id = ?").get(qq) as { id: string } | undefined;
    return a ? [a.id] : [];
  })();
  if (anchors.length === 0) return null;
  const fallbackName = (() => {
    const a = db.prepare("SELECT name FROM anchors WHERE id = ?").get(anchors[0]!) as { name: string } | undefined;
    return a && !/^\d+$/.test(a.name) ? a.name : "";
  })();
  const ph = anchors.map(() => "?").join(",");

  const spokeRows = db
    .prepare(
      `SELECT e.title FROM event_anchors ea JOIN events e ON e.id = ea.event_id
       WHERE ea.anchor_id IN (${ph}) AND ea.role = 'speaker' AND e.archived = 0
       ORDER BY e.ts DESC LIMIT ?`,
    )
    .all(...anchors, limit) as Array<{ title: string }>;

  const aboutRows = db
    .prepare(
      `SELECT e.title FROM event_anchors ea JOIN events e ON e.id = ea.event_id
       WHERE ea.anchor_id IN (${ph}) AND ea.role <> 'speaker' AND e.archived = 0
       ORDER BY e.ts DESC LIMIT ?`,
    )
    .all(...anchors, limit) as Array<{ title: string }>;

  let aliases: string[] = [];
  try {
    aliases = (JSON.parse(row?.aliases || "[]") as string[]).filter((a) => a.trim().length > 0 && !/^QQ\d+$/.test(a.trim()));
  } catch {
    aliases = [];
  }

  return {
    qqId: qq,
    name: String(row?.display_name ?? "").trim() || fallbackName,
    aliases,
    spoke: spokeRows.map((r) => brief(r.title)).filter((s) => s.length > 0),
    about: aboutRows.map((r) => brief(r.title)).filter((s) => s.length > 0),
  };
}

/** 给一批 QQ 号各拿一张卡（去重、跳过没有的） */
export function personCardsFor(db: DatabaseSync, qqIds: Array<string | number>, limit = 2): PersonCard[] {
  const out: PersonCard[] = [];
  const seen = new Set<string>();
  for (const id of qqIds) {
    const qq = String(id ?? "").trim();
    if (!qq || seen.has(qq)) continue;
    seen.add(qq);
    try {
      const card = personCard(db, qq, limit);
      if (card) out.push(card);
    } catch {
      // 拿不到这张卡不影响别的
    }
  }
  return out;
}
