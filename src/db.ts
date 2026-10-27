import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { EventRow, Stage, Tier } from "./types.ts";
import { fromJson } from "./util.ts";

export const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  day TEXT NOT NULL,
  ts INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  session_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  ts INTEGER NOT NULL,
  period_label TEXT,
  tier TEXT NOT NULL,
  stage TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  cause TEXT,
  effect TEXT,
  core_fragment TEXT,
  affect_valence REAL NOT NULL DEFAULT 0,
  affect_arousal REAL NOT NULL DEFAULT 0,
  affect_tags TEXT NOT NULL DEFAULT '[]',
  affect_summary TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  pin_expires_at INTEGER,
  key_facts TEXT NOT NULL DEFAULT '[]',
  strength REAL NOT NULL DEFAULT 1.0,
  mentions INTEGER NOT NULL DEFAULT 1,
  derived_from TEXT NOT NULL DEFAULT '[]',
  context_kinds TEXT NOT NULL DEFAULT '[]',
  size_tokens INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  source_turn_id TEXT,
  -- v3 事件卡的字段。以前只在线上库里（开发时用临时补丁脚本加的），
  -- 没合进 SCHEMA，所以「从仓库新建的库」存不下 etype/status/evidence 这些。
  etype TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  responsible TEXT NOT NULL DEFAULT '',
  time_absolute TEXT NOT NULL DEFAULT '',
  time_relative TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  sensitivity TEXT NOT NULL DEFAULT '',
  expires_at INTEGER,
  memory_value INTEGER NOT NULL DEFAULT 0,
  valid_to INTEGER,
  superseded_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_tier ON events(tier, ts);
CREATE INDEX IF NOT EXISTS idx_events_stage ON events(stage);

CREATE TABLE IF NOT EXISTS cold_archive (
  event_id TEXT PRIMARY KEY,
  address TEXT,
  gist TEXT,
  event_day TEXT,
  raw_detail TEXT NOT NULL,
  archived_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_pins (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS anchors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  salience REAL NOT NULL DEFAULT 1.0,
  hits INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  -- 人节点要记「外部身份」（QQ 号），原本由 people.ts 懒加，新库会缺
  external_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS anchor_aliases (
  alias TEXT PRIMARY KEY,
  anchor_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0
);

-- people 原本由 people.ts 在「第一次见到这个人」时懒建；
-- 但睡眠里的人↔锚点绑定会先用到它，新库就会报 no such table: people。
CREATE TABLE IF NOT EXISTS people (
  qq_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  aliases TEXT NOT NULL DEFAULT '[]',
  anchor_id TEXT NOT NULL DEFAULT '',
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  relation TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  last_reinforced INTEGER NOT NULL,
  PRIMARY KEY (src, dst, relation)
);

CREATE TABLE IF NOT EXISTS event_anchors (
  event_id TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (event_id, anchor_id)
);

CREATE TABLE IF NOT EXISTS mood_state (
  id TEXT PRIMARY KEY,
  valence REAL NOT NULL DEFAULT 0,
  arousal REAL NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '平静',
  note TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

-- 今天看过哪些视频（防止同一个视频反复消耗额度）
CREATE TABLE IF NOT EXISTS watched_videos (
  day TEXT NOT NULL,
  bvid TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  watched_at INTEGER NOT NULL,
  PRIMARY KEY (day, bvid)
);

-- 每日额度：制造稀缺，逼它做选择
CREATE TABLE IF NOT EXISTS daily_quota (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);

CREATE TABLE IF NOT EXISTS sleep_runs (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  stats TEXT,
  error TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS event_fts USING fts5(
  event_id UNINDEXED,
  title,
  cause,
  effect,
  core_fragment,
  affect_summary,
  tokenize='trigram'
);

-- 模型抽取的原始输出。落库即冻结，重跑睡眠不再重抽，保证「睡眠幂等」。
CREATE TABLE IF NOT EXISTS llm_extractions (
  day TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  raw TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export function openDb(path: string): DatabaseSync {
  const inMemory = path === ":memory:" || path === "";
  const target = inMemory ? ":memory:" : resolve(path);
  if (!inMemory) mkdirSync(dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  db.exec("PRAGMA journal_mode = WAL;");
  // 两个 BotService 共用一个库：写冲突时等一会儿，别直接把这条消息丢掉（2026-10-26 切 SnowLuma 时见过 database is locked）
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  // 顺序要紧：老库可能缺 stage，而 SCHEMA 里有 CREATE INDEX ... ON events(stage)。
  // 先建表/建索引的话，还没补列就已经炸了（"no such column: stage"）。
  // 所以先补这一步关键列；表还不存在时 ensureColumn 会抛，忽略即可。
  try {
    ensureColumn(db, "events", "stage", "TEXT NOT NULL DEFAULT 'legacy'");
  } catch {
    // 表还不存在，SCHEMA 会建出来
  }
  db.exec(SCHEMA);
  // 老库补列：原型阶段用 ADD COLUMN 就够了，不写完整迁移框架
  // stage 从第一版就在建表语句里，所以以前没进补列清单；
  // 但只要拿到的是更早/别处生成的库，openDb 就会直接报 "no such column: stage"。
  // 补一个默认值 'legacy'，让老库能开起来（2026-10-26 有人从 GitHub 拿到后就这么卡住）。
  ensureColumn(db, "events", "stage", "TEXT NOT NULL DEFAULT 'legacy'");
  // v3 事件卡字段：老库也要补，否则抽取写不进去（同一批字段只在线上库里有）
  for (const [col, ddl] of [
    ["etype", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT ''"],
    ["responsible", "TEXT NOT NULL DEFAULT ''"],
    ["time_absolute", "TEXT NOT NULL DEFAULT ''"],
    ["time_relative", "TEXT NOT NULL DEFAULT ''"],
    ["place", "TEXT NOT NULL DEFAULT ''"],
    ["evidence", "TEXT NOT NULL DEFAULT ''"],
    ["sensitivity", "TEXT NOT NULL DEFAULT ''"],
    ["expires_at", "INTEGER"],
    ["memory_value", "INTEGER NOT NULL DEFAULT 0"],
    ["valid_to", "INTEGER"],
    ["superseded_by", "TEXT NOT NULL DEFAULT ''"],
  ] as Array<[string, string]>) {
    ensureColumn(db, "events", col, ddl);
  }
  ensureColumn(db, "events", "pin_expires_at", "INTEGER");
  // anchors 的 external_id 原本也只在 people.ts 里懒加，新库缺它 → 睡眠里人↔锚点绑定直接报错
  ensureColumn(db, "anchors", "external_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "anchors", "can_dm", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "anchors", "impression", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "events", "derived_from", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "events", "context_kinds", "TEXT NOT NULL DEFAULT '[]'");
  // 共享记忆下要知道这条是谁的事：检索时优先匹配当前说话人
  ensureColumn(db, "events", "speaker_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "turns", "speaker_id", "TEXT NOT NULL DEFAULT ''");
  // 这句对话是从哪来的：私聊 <qq>、群 g:<群号>:<qq>、她自己活动 autonomy。
  // 没有它，就分不清某条记忆是群里的还是私聊的，群场景的名单也只能把全库的人混在一起。
  ensureColumn(db, "turns", "session_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "events", "key_facts", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "events", "strength", "REAL NOT NULL DEFAULT 1.0");
  ensureColumn(db, "events", "mentions", "INTEGER NOT NULL DEFAULT 1");
  // 一件事里的角色不止一个：谁说的、说的是谁、提到谁
  ensureColumn(db, "event_anchors", "role", "TEXT NOT NULL DEFAULT 'mentioned'");
  // 记忆分四类（借 sage-mem 的分法）：
  //   user 你是谁 / feedback 该怎么做事 / project 项目状态 / reference 外部指针 / event 发生过的事
  ensureColumn(db, "events", "kind", "TEXT NOT NULL DEFAULT 'event'");
  // 取舍的裁定：keep / demote / superseded / noise，附一句为什么
  ensureColumn(db, "events", "verdict", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "events", "verdict_reason", "TEXT NOT NULL DEFAULT ''");
  // 从哪一刻起失效（被后来事实推翻的，这里记时间，不删）
  ensureColumn(db, "events", "invalid_at", "INTEGER");
  ensureColumn(db, "anchor_aliases", "confidence", "REAL NOT NULL DEFAULT 1.0");
  // 抽取缓存按「这一批对话的指纹」区分：只按天，会把后来新说的话全跳过
  ensureColumn(db, "llm_extractions", "sig", "TEXT NOT NULL DEFAULT ''");
  // 「当时什么感受」和「现在想起来什么感受」是两回事。
  // 只有前者的话，以后会用后来的平静去冒充当时的难受。
  ensureColumn(db, "events", "felt_now_valence", "REAL");
  ensureColumn(db, "events", "felt_now_arousal", "REAL");
  ensureColumn(db, "events", "felt_now_at", "INTEGER");
  ensureColumn(db, "cold_archive", "address", "TEXT");
  ensureColumn(db, "cold_archive", "gist", "TEXT");
  ensureColumn(db, "cold_archive", "event_day", "TEXT");
  ensureColumn(db, "cold_archive", "tier_at_forget", "TEXT");
  // 索引要等列真的存在了再建，否则老库会在这里炸
  db.exec("CREATE INDEX IF NOT EXISTS idx_cold_address ON cold_archive(address)");

  // 老库的底片没有地址，补上：地址就是唯一标识，不能重复生成
  for (const row of db.prepare("SELECT event_id FROM cold_archive WHERE address IS NULL").all()) {
    db.prepare("UPDATE cold_archive SET address = ? WHERE event_id = ?").run(
      coldAddress(String(row.event_id)),
      String(row.event_id),
    );
  }

  const current = getMeta(db, "schema_version");
  if (current === null) setMeta(db, "schema_version", String(SCHEMA_VERSION));
  else if (Number(current) !== SCHEMA_VERSION) setMeta(db, "schema_version", String(SCHEMA_VERSION));
}

function ensureColumn(db: DatabaseSync, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => String(c.name) === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

/** 冷存储地址。稳定、可写进上下文、能被显式 deref。 */
export function coldAddress(eventId: string): string {
  return `cold://${eventId}`;
}

export function getMeta(db: DatabaseSync, k: string): string | null {
  const row = db.prepare("SELECT v FROM meta WHERE k = ?").get(k);
  return row ? String(row.v) : null;
}

export function setMeta(db: DatabaseSync, k: string, v: string): void {
  db.prepare("INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
}

/** FTS 与 events 表手工同步，比触发器好调试。 */
export function reindexEventFts(db: DatabaseSync, eventId: string): void {
  db.prepare("DELETE FROM event_fts WHERE event_id = ?").run(eventId);
  const e = db.prepare("SELECT id, title, cause, effect, core_fragment, affect_summary FROM events WHERE id = ?").get(eventId);
  if (!e) return;
  db.prepare(
    "INSERT INTO event_fts(event_id, title, cause, effect, core_fragment, affect_summary) VALUES(?,?,?,?,?,?)",
  ).run(e.id, e.title ?? "", e.cause ?? "", e.effect ?? "", e.core_fragment ?? "", e.affect_summary ?? "");
}

export function resetDb(db: DatabaseSync): void {
  for (const t of ["event_fts", "event_anchors", "edges", "anchor_aliases", "anchors", "cold_archive", "events", "turns", "mood_state", "sleep_runs", "meta"]) {
    db.exec(`DELETE FROM ${t}`);
  }
}

export function tierTotals(db: DatabaseSync): Record<string, { count: number; tokens: number }> {
  const rows = db.prepare("SELECT tier, COUNT(*) AS c, COALESCE(SUM(size_tokens),0) AS t FROM events GROUP BY tier").all();
  const out: Record<string, { count: number; tokens: number }> = {
    detailed: { count: 0, tokens: 0 },
    compressed: { count: 0, tokens: 0 },
    fossil: { count: 0, tokens: 0 },
  };
  for (const r of rows) out[String(r.tier)] = { count: Number(r.c), tokens: Number(r.t) };
  return out;
}

export function rowToEvent(r: Record<string, unknown>): EventRow {
  return {
    id: String(r.id),
    day: String(r.day),
    ts: Number(r.ts),
    periodLabel: (r.period_label as string | null) ?? null,
    tier: String(r.tier) as Tier,
    stage: String(r.stage) as Stage,
    title: String(r.title),
    detail: (r.detail as string | null) ?? null,
    cause: (r.cause as string | null) ?? null,
    effect: (r.effect as string | null) ?? null,
    coreFragment: (r.core_fragment as string | null) ?? null,
    affect: {
      valence: Number(r.affect_valence ?? 0),
      arousal: Number(r.affect_arousal ?? 0),
      tags: fromJson<string[]>(r.affect_tags as string, []),
      summary: String(r.affect_summary ?? ""),
      core: String(r.core_fragment ?? ""),
    },
    pinned: Number(r.pinned ?? 0) === 1,
    sizeTokens: Number(r.size_tokens ?? 0),
    archived: Number(r.archived ?? 0) === 1,
    keyFacts: fromJson<string[]>(r.key_facts as string, []),
    strength: Number(r.strength ?? 1),
    mentions: Number(r.mentions ?? 1),
    derivedFrom: fromJson<string[]>(r.derived_from as string, []),
    contextKinds: fromJson<string[]>(r.context_kinds as string, []),
    speakerId: String(r.speaker_id ?? ""),
    feltNow:
      r.felt_now_valence === null || r.felt_now_valence === undefined
        ? undefined
        : {
            valence: Number(r.felt_now_valence),
            arousal: Number(r.felt_now_arousal ?? 0),
            at: Number(r.felt_now_at ?? 0),
          },
    sourceTurnId: (r.source_turn_id as string | null) ?? null,
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
  };
}

export function getEvent(db: DatabaseSync, id: string): EventRow | null {
  const r = db.prepare("SELECT * FROM events WHERE id = ?").get(id);
  return r ? rowToEvent(r as Record<string, unknown>) : null;
}

