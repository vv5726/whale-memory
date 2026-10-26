import type { DatabaseSync } from "node:sqlite";
import type { ActivationNode, AnchorHit, AnchorKind, MemoryConfig } from "./types.ts";
import { clamp, newId } from "./util.ts";

/** 别名最短长度：单字别名（如「王」「溪」）会造成大面积误命中，直接忽略。 */
const MIN_ALIAS_LEN = 2;

/** 同一性关系的名字：权重 1.0 = 同一个目标的不同叫法。 */
export const SAME_AS = "same-as";

export interface AnchorRecord {
  id: string;
  name: string;
  kind: AnchorKind;
  salience: number;
  hits: number;
}

export interface AnchorIndex {
  byId: Map<string, AnchorRecord>;
  aliasToAnchor: Map<string, { anchorId: string; confidence: number }>;
  aliases: Array<{ alias: string; anchorId: string; confidence: number }>;
}

export function loadAnchorIndex(db: DatabaseSync): AnchorIndex {
  const anchors = db.prepare("SELECT id, name, kind, salience, hits FROM anchors").all();
  const byId = new Map<string, AnchorRecord>();
  const aliasToAnchor = new Map<string, { anchorId: string; confidence: number }>();
  const aliases: Array<{ alias: string; anchorId: string; confidence: number }> = [];

  for (const a of anchors) {
    const rec: AnchorRecord = {
      id: String(a.id),
      name: String(a.name),
      kind: String(a.kind) as AnchorKind,
      salience: Number(a.salience),
      hits: Number(a.hits),
    };
    byId.set(rec.id, rec);
    aliasToAnchor.set(rec.name, { anchorId: rec.id, confidence: 1.0 });
    aliases.push({ alias: rec.name, anchorId: rec.id, confidence: 1.0 });
  }

  for (const row of db.prepare("SELECT alias, anchor_id, confidence FROM anchor_aliases").all()) {
    const alias = String(row.alias);
    const anchorId = String(row.anchor_id);
    if ([...alias].length < MIN_ALIAS_LEN) continue;
    const confidence = Number(row.confidence ?? 1.0);
    const prev = aliasToAnchor.get(alias);
    if (!prev || confidence > prev.confidence) aliasToAnchor.set(alias, { anchorId, confidence });
    aliases.push({ alias, anchorId, confidence });
  }

  // 长别名优先，避免「王建国」先被「建国」这类短别名截胡
  aliases.sort((x, y) => [...y.alias].length - [...x.alias].length);
  return { byId, aliasToAnchor, aliases };
}

/**
 * 从自由文本里捞出已知锚点。锚点数量在千级以内，直接子串扫描即可，无需 FTS。
 * 同一个锚点被多个别名命中时，取置信度最高的那个。
 */
export function matchAnchors(index: AnchorIndex, text: string): AnchorHit[] {
  const best = new Map<string, AnchorHit>();
  for (const { alias, anchorId, confidence } of index.aliases) {
    if (!text.includes(alias)) continue;
    const rec = index.byId.get(anchorId);
    if (!rec) continue;
    const prev = best.get(anchorId);
    if (prev && prev.confidence >= confidence) continue;
    best.set(anchorId, { anchorId, name: rec.name, kind: rec.kind, alias, confidence });
  }
  return [...best.values()];
}

export function ensureAnchor(
  db: DatabaseSync,
  name: string,
  kind: AnchorKind,
  nowTs: number,
): string {
  const existing = db.prepare("SELECT id FROM anchors WHERE name = ?").get(name);
  if (existing) return String(existing.id);
  const id = newId("anc");
  db.prepare(
    "INSERT INTO anchors(id, name, kind, salience, hits, first_seen, last_seen) VALUES(?,?,?,?,?,?,?)",
  ).run(id, name, kind, 1.0, 0, nowTs, nowTs);
  db.prepare("INSERT OR REPLACE INTO anchor_aliases(alias, anchor_id, confidence) VALUES(?,?,1.0)").run(name, id);
  return id;
}

/**
 * 登记一个名字指向某个锚点的程度。
 * confidence = 1.0：同一个目标的不同叫法（老王 / 王建国）。
 * confidence < 1：大概是它，但不保证（「王总」可能是王建国，也可能是别人）。
 */
export function addAlias(db: DatabaseSync, alias: string, anchorId: string, confidence = 1.0): void {
  if ([...alias].length < MIN_ALIAS_LEN) return;
  db.prepare(
    "INSERT INTO anchor_aliases(alias, anchor_id, confidence) VALUES(?,?,?) ON CONFLICT(alias) DO UPDATE SET anchor_id = excluded.anchor_id, confidence = MAX(confidence, excluded.confidence)",
  ).run(alias, anchorId, clamp(confidence, 0.05, 1.0));
}

export function linkEventAnchor(db: DatabaseSync, eventId: string, anchorId: string, weight: number): void {
  db.prepare(
    "INSERT INTO event_anchors(event_id, anchor_id, weight) VALUES(?,?,?) ON CONFLICT(event_id, anchor_id) DO UPDATE SET weight = MAX(weight, excluded.weight)",
  ).run(eventId, anchorId, weight);
}

/**
 * 把两个锚点标成「同一个东西」，weight=1 就是别名归一的极端情况。
 * 睡眠时会把 weight 达标的一对真正合并成一个节点。
 */
export function linkIdentity(
  db: DatabaseSync,
  a: string,
  b: string,
  weight: number,
  nowTs: number,
): boolean {
  return reinforceEdge(db, a, b, SAME_AS, nowTs, weight, weight);
}

export function reinforceEdge(
  db: DatabaseSync,
  a: string,
  b: string,
  relation: string,
  nowTs: number,
  delta = 0.5,
  initial = 1.0,
): boolean {
  if (a === b) return false;
  const [src, dst] = a < b ? [a, b] : [b, a];
  const existing = db.prepare("SELECT weight FROM edges WHERE src = ? AND dst = ? AND relation = ?").get(src, dst, relation);
  if (existing) {
    db.prepare("UPDATE edges SET weight = MIN(3.0, weight + ?), last_reinforced = ? WHERE src = ? AND dst = ? AND relation = ?")
      .run(delta, nowTs, src, dst, relation);
    return false;
  }
  db.prepare("INSERT INTO edges(src, dst, relation, weight, last_reinforced) VALUES(?,?,?,?,?)")
    .run(src, dst, relation, initial, nowTs);
  return true;
}

export function bumpAnchorHits(db: DatabaseSync, anchorId: string, nowTs: number, delta = 1): void {
  db.prepare("UPDATE anchors SET hits = hits + ?, last_seen = ?, salience = MIN(3.0, salience + 0.05) WHERE id = ?")
    .run(delta, nowTs, anchorId);
}

/**
 * 扩散激活：种子 1.0，一跳 ×0.5，二跳 ×0.25。
 *
 * 例外是 same-as 边：两个节点只是同一个东西的两种叫法，
 * 激活沿着它走不该衰减（权重 1.0 时完全穿透），否则「老王」想不起「王建国」的事。
 */
export function spreadActivation(
  db: DatabaseSync,
  index: AnchorIndex,
  seeds: Array<{ anchorId: string; confidence: number }>,
  cfg: MemoryConfig,
): ActivationNode[] {
  if (seeds.length === 0) return [];

  const adj = new Map<string, Array<{ to: string; w: number; identity: boolean }>>();
  const loadAdj = (id: string) => {
    if (adj.has(id)) return adj.get(id)!;
    const rows = db.prepare("SELECT src, dst, relation, weight FROM edges WHERE src = ? OR dst = ?").all(id, id);
    const list = rows.map((r) => ({
      to: String(r.src) === id ? String(r.dst) : String(r.src),
      w: Number(r.weight),
      identity: String(r.relation) === SAME_AS,
    }));
    adj.set(id, list);
    return list;
  };

  const best = new Map<string, { score: number; hop: number; via: string | null }>();
  let frontier: Array<{ id: string; score: number; hop: number; via: string | null }> = [];

  for (const seed of seeds) {
    const rec = index.byId.get(seed.anchorId);
    if (!rec) continue;
    const base =
      cfg.hopDecay[0] *
      clamp(0.8 + Math.log1p(rec.hits) * 0.1, 0.8, 1.6) *
      clamp(seed.confidence, 0.05, 1.0);
    const prev = best.get(seed.anchorId);
    if (!prev || base > prev.score) best.set(seed.anchorId, { score: base, hop: 0, via: null });
    frontier.push({ id: seed.anchorId, score: base, hop: 0, via: null });
  }

  for (let hop = 1; hop <= cfg.maxHops; hop += 1) {
    const next: typeof frontier = [];
    const decay = cfg.hopDecay[hop] ?? 0;
    for (const node of frontier) {
      for (const edge of loadAdj(node.id)) {
        const score = edge.identity
          ? node.score * clamp(edge.w, 0, 1)
          : node.score * decay * clamp(edge.w, 0, 2) * (1 / 1.4);
        const prev = best.get(edge.to);
        if (prev && prev.score >= score) continue;
        best.set(edge.to, { score, hop, via: node.id });
        next.push({ id: edge.to, score, hop, via: node.id });
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  const out: ActivationNode[] = [];
  for (const [anchorId, v] of best) {
    const rec = index.byId.get(anchorId);
    if (!rec) continue;
    out.push({ anchorId, name: rec.name, kind: rec.kind, score: v.score, hop: v.hop, via: v.via });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export function decayAnchors(db: DatabaseSync, factor: number): number {
  const res = db.prepare("UPDATE anchors SET salience = MAX(0.1, salience * ?)").run(factor);
  return Number(res.changes ?? 0);
}

/**
 * 把「100% 关联」的锚点真正合并成一个节点。
 *
 * 这是别名归一的终点：老王 / 王哥 / 王建国 之间如果已经连成 weight=1 的 same-as 边，
 * 就不该再作为三个节点各算一遍激活——那会让一个人的事被记成三个人的事。
 */
export function contractIdentityAnchors(db: DatabaseSync, threshold: number): number {
  const pairs = db
    .prepare("SELECT src, dst, weight FROM edges WHERE relation = ? AND weight >= ?")
    .all(SAME_AS, threshold);
  if (pairs.length === 0) return 0;

  let merged = 0;
  for (const p of pairs) {
    const a = String(p.src);
    const b = String(p.dst);
    const ra = db.prepare("SELECT id, name, hits, salience FROM anchors WHERE id = ?").get(a);
    const rb = db.prepare("SELECT id, name, hits, salience FROM anchors WHERE id = ?").get(b);
    if (!ra || !rb) continue;
    const countA = Number(db.prepare("SELECT COUNT(*) AS c FROM event_anchors WHERE anchor_id = ?").get(a)?.c ?? 0);
    const countB = Number(db.prepare("SELECT COUNT(*) AS c FROM event_anchors WHERE anchor_id = ?").get(b)?.c ?? 0);
    const keepA =
      Number(ra.hits) > Number(rb.hits) || (Number(ra.hits) === Number(rb.hits) && countA >= countB);
    const keep = keepA ? ra : rb;
    const drop = keepA ? rb : ra;
    const keepId = String(keep.id);
    const dropId = String(drop.id);

    // 被并掉的那个名字本身要变成幸存者的别名，检索才还得回来
    db.prepare("INSERT OR REPLACE INTO anchor_aliases(alias, anchor_id, confidence) VALUES(?,?,1.0)").run(
      String(drop.name),
      keepId,
    );
    db.prepare("UPDATE anchor_aliases SET anchor_id = ? WHERE anchor_id = ?").run(keepId, dropId);
    for (const link of db.prepare("SELECT event_id, weight FROM event_anchors WHERE anchor_id = ?").all(dropId)) {
      db.prepare(
        "INSERT INTO event_anchors(event_id, anchor_id, weight) VALUES(?,?,?) ON CONFLICT(event_id, anchor_id) DO UPDATE SET weight = MAX(weight, excluded.weight)",
      ).run(String(link.event_id), keepId, Number(link.weight));
    }
    db.prepare("DELETE FROM event_anchors WHERE anchor_id = ?").run(dropId);
    db.prepare("DELETE FROM edges WHERE src = ? OR dst = ?").run(dropId, dropId);
    db.prepare("UPDATE anchors SET hits = hits + ?, salience = MAX(salience, ?) WHERE id = ?").run(
      Number(drop.hits),
      Number(drop.salience ?? 1),
      keepId,
    );
    db.prepare("DELETE FROM anchors WHERE id = ?").run(dropId);
    merged += 1;
  }
  return merged;
}

/**
 * 关系也会淡。
 *
 * 「同一天出现过」这种边很廉价：一天里冒出三十个锚点，就是四百多条边。
 * 但它们是**真的**——只是不该一直那么重。老边随时间变淡，新边补上来，
 * 关系网才跟着生活在变，而不是越攒越僵。
 *
 * 按「距离上次被强化过了多久」算：半衰期 halfLifeDays 天，降到 floor 以下就删。
 */
export function decayEdges(db: DatabaseSync, halfLifeDays = 7, floor = 0.05, nowTs = Date.now()): number {
  const rows = db
    .prepare("SELECT rowid, src, dst, relation, weight, last_reinforced FROM edges")
    .all() as Array<{ rowid: number; weight: number; last_reinforced: number }>;

  let changed = 0;
  for (const r of rows) {
    const ageDays = Math.max(0, (nowTs - Number(r.last_reinforced ?? nowTs)) / 86_400_000);
    if (ageDays < 0.5) continue; // 太新，先不动

    const factor = Math.pow(0.5, ageDays / halfLifeDays);
    const next = Number(r.weight ?? 1) * factor;

    if (next < floor) {
      db.prepare("DELETE FROM edges WHERE rowid = ?").run(r.rowid);
      changed += 1;
      continue;
    }
    // 只降到 0.05 以上才值得写；同时把 last_reinforced 推到这次，避免重复衰减
    db.prepare("UPDATE edges SET weight = ?, last_reinforced = ? WHERE rowid = ?").run(next, nowTs, r.rowid);
    changed += 1;
  }
  return changed;
}