import type { DatabaseSync } from "node:sqlite";
import type {
  AffectivePick,
  ColdHint,
  EventRow,
  MemoryConfig,
  RecallCandidate,
  RecallResult,
} from "./types.ts";
import { loadAnchorIndex, matchAnchors, spreadActivation } from "./anchors.ts";
import { getEvent, rowToEvent } from "./db.ts";
import { dereference, coldHints as findColdHints } from "./cold.ts";
import { moodLabel } from "./affect.ts";
import { bigrams as toBigrams } from "./text.ts";
import {
  clamp,
  daysBetween,
  estimateTokens,
  hashSeed,
  mulberry32,
  periodLabel,
  sampleIndex,
  softmax,
  truncate,
} from "./util.ts";

/** 兼容旧调用点：字面通道的实现已经挪到 text.ts */
export const bigrams = toBigrams;
export { lexicalOverlap } from "./text.ts";

function ftsHitIds(db: DatabaseSync, query: string): Set<string> {
  const out = new Set<string>();
  const runs = query.split(/[^\u4e00-\u9fa5a-zA-Z0-9]+/).filter((r) => [...r].length >= 3);
  for (const run of runs) {
    try {
      for (const row of db.prepare("SELECT event_id FROM event_fts WHERE event_fts MATCH ? LIMIT 20").all(`"${run}"`)) {
        out.add(String(row.event_id));
      }
    } catch {
      // 查询语法不合法或没有匹配，忽略即可，字面通道还有 bigram 兜底
    }
  }
  return out;
}

export interface RecallOptions {
  sessionId?: string;
  /** 当前说话人：共享记忆下他的事优先 */
  speakerId?: string;
  nowTs?: number;
  factTopK?: number;
  /** 第一轮没想出东西时放宽，再召回一批 */
  allowMore?: boolean;
  seedOverride?: number;
}

export function recall(
  db: DatabaseSync,
  cfg: MemoryConfig,
  query: string,
  opts: RecallOptions = {},
): RecallResult {
  const nowTs = opts.nowTs ?? Date.now();
  const sessionId = opts.sessionId ?? "default";
  const index = loadAnchorIndex(db);

  const seeds = matchAnchors(index, query);
  const activation = spreadActivation(
    db,
    index,
    seeds.map((s) => ({ anchorId: s.anchorId, confidence: s.confidence })),
    cfg,
  );
  const activationMap = new Map(activation.map((a) => [a.anchorId, a.score]));

  // ★ 惰性展开：先只取分数最高的一小批锚点，低于门槛的不参与。
  //   原来是把所有激活锚点一起累加，一次拉一大片，噪音多、token 也贵。
  const ACTIVATION_TOP = opts.allowMore === true ? 12 : 6;
  const ACTIVATION_MIN = 0.15;
  const rankedActivation = [...activationMap.entries()]
    .filter(([, score]) => score >= ACTIVATION_MIN)
    .sort((a, b) => b[1] - a[1])
    .slice(0, ACTIVATION_TOP);
  const liveActivation = new Map(rankedActivation);

  // 事件 → 被激活锚点的证据强度
  const evidence = new Map<string, { score: number; topAnchor: string | null }>();
  const anchorsOfEvent = new Map<string, string[]>();
  const eventsOfAnchor = new Map<string, string[]>();
  const links = db.prepare("SELECT event_id, anchor_id, weight FROM event_anchors").all();

  for (const l of links) {
    const eid = String(l.event_id);
    const aid = String(l.anchor_id);
    if (!anchorsOfEvent.has(eid)) anchorsOfEvent.set(eid, []);
    anchorsOfEvent.get(eid)!.push(aid);
    if (!eventsOfAnchor.has(aid)) eventsOfAnchor.set(aid, []);
    eventsOfAnchor.get(aid)!.push(eid);

    const act = liveActivation.get(aid);
    if (act === undefined) continue;
    const add = act * Number(l.weight);
    const prev = evidence.get(eid);
    if (!prev) evidence.set(eid, { score: add, topAnchor: aid });
    else {
      if (add > prev.score - add) prev.topAnchor = aid;
      prev.score += add;
    }
  }

  // 情景连带：想起「我妈住院」应该顺带想起同时期那张病理报告。
  // 同一个人、同一段日子里的事，本来就该一起浮上来。
  const SIBLING_WINDOW_DAYS = 120;
  const tsOfEvent = new Map<string, number>();
  for (const raw of db.prepare("SELECT id, ts FROM events WHERE archived = 0").all()) {
    tsOfEvent.set(String(raw.id), Number(raw.ts));
  }
  const siblingBonus = new Map<string, number>();
  const strong = [...evidence.entries()].filter(([, v]) => v.score >= 0.9).slice(0, 40);
  for (const [eid, v] of strong) {
    const ts = tsOfEvent.get(eid) ?? 0;
    for (const aid of anchorsOfEvent.get(eid) ?? []) {
      for (const other of eventsOfAnchor.get(aid) ?? []) {
        if (other === eid) continue;
        if (daysBetween(tsOfEvent.get(other) ?? 0, ts) > SIBLING_WINDOW_DAYS) continue;
        const prev = siblingBonus.get(other) ?? 0;
        const next = v.score * 0.35;
        if (next > prev) siblingBonus.set(other, next);
      }
    }
  }

  const ftsHits = ftsHitIds(db, query);
  const allRows = db.prepare("SELECT * FROM events WHERE archived = 0").all();

  // 字面通道用 IDF 加权的 bigram：像「吵架」这种只出现在一两条记忆里的词才有分量，
  // 「我们」「什么」这种到处都是的词几乎不算数。
  const docGrams = new Map<string, Set<string>>();
  const df = new Map<string, number>();
  for (const raw of allRows) {
    const e = rowToEvent(raw as Record<string, unknown>);
    const grams = bigrams(eventText(e));
    docGrams.set(e.id, grams);
    for (const g of grams) df.set(g, (df.get(g) ?? 0) + 1);
  }
  const N = allRows.length;
  const queryGrams = new Set([...bigrams(query)].filter((g) => (df.get(g) ?? 0) > 0));
  const idf = (g: string) => Math.log((N + 1) / ((df.get(g) ?? 0) + 1));
  const queryMass = [...queryGrams].reduce((a, g) => a + idf(g), 0);

  const candidates: RecallCandidate[] = [];

  for (const raw of allRows) {
    const e = rowToEvent(raw as Record<string, unknown>);
    const ev = evidence.get(e.id);
    const anchorEvidence = (ev?.score ?? 0) + (siblingBonus.get(e.id) ?? 0);

    const grams = docGrams.get(e.id) ?? new Set<string>();
    let matchedMass = 0;
    for (const g of queryGrams) if (grams.has(g)) matchedMass += idf(g);
    const lexical = queryMass > 0 ? matchedMass / queryMass : 0;
    const lexicalBoost = lexical > 0.15 ? (lexical - 0.1) * 1.15 : 0;
    const ftsBoost = ftsHits.has(e.id) ? 0.6 : 0;

    // 新鲜度：普通记忆按半衰期 30 天淡（抄 fish-memory 的曲线），
    // 但钉住的、或者带关键事实的（长期事实）不淡——这类东西越久越该想起来。
    const isDurable = e.pinned || e.keyFacts.length > 0;
    const ageDays = daysBetween(e.ts, nowTs);
    const freshness = isDurable ? 1 : Math.pow(0.5, ageDays / 30);
    const recencyBonus = cfg.recencyWeight * freshness * 0.5;
    const arousalBonus = cfg.arousalBonus * e.affect.arousal;

    // 没有任何线索指向它的事件不参与排序：情绪强度只用来在「想得起来的」里加分，
    // 不能凭空把一条无关的旧事顶上来。
    const evidenceTotal = anchorEvidence + lexicalBoost + ftsBoost;
    if (evidenceTotal < 0.05) continue;

    // 共享记忆下：是当前说话人的事，权重高一点；别人的事降一点。
    // 这样「我妈」在你问的时候不会捞到朋友的妈妈。
    const speakerFactor =
      !opts.speakerId || e.speakerId.length === 0
        ? 1
        : e.speakerId === opts.speakerId
          ? 1.25
          : 0.75;

    // 同一条线索下常常有好几版记忆：完整的、半截的、聊这件事的过程。
    // 不区分就会把半截的那条排前面，模型据此判断「其实没有这回事」。
    // 标题里出现问题的关键词，说明这条**就是在讲这件事**，比正文顺带提到的强得多
    const titleText = String(e.title ?? "");
    // 标题短且直接命中：这条就是在讲这件事，压过那些「顺带提到」的长条目
    const titleHit =
      [...queryGrams].some((g) => g.length >= 2 && titleText.includes(g)) && titleText.length <= 30 ? 2.6 : 1;

    const raw4 = (evidenceTotal + arousalBonus + recencyBonus) * speakerFactor * qualityOf(e) * titleHit;
    const tierAccess = cfg.tierAccessibility[e.tier];
    // 钉住 =「想起来时更牢」，不是「永远置顶」：证据越强放大越多
    const pinnedBonus = e.pinned ? cfg.pinnedBonus * clamp(evidenceTotal, 0, 1) : 0;

    const total = (raw4 * tierAccess + pinnedBonus) * (1 + 0.25 * (e.strength - 1));
    if (total <= 0.02) continue;

    candidates.push({
      event: e,
      breakdown: {
        evidence: round3(evidenceTotal),
        anchorEvidence: round3(anchorEvidence),
        arousalBonus: round3(arousalBonus),
        recencyBonus: round3(recencyBonus),
        tierAccessibility: tierAccess,
        pinnedBonus: round3(pinnedBonus),
        total: round3(total),
      },
    });
  }

  candidates.sort((a, b) => b.breakdown.total - a.breakdown.total);
  // 相关性闸门用「证据」而不是「最终分」：久远的记忆因为可达性低而排不上去，
  // 但只要线索确实指向它，就不能当作「没想起来」直接丢掉。
  const maxEvidence = candidates.reduce((m, c) => Math.max(m, c.breakdown.evidence), 0);
  const cutoff = Math.min(0.25, Math.max(0.06, maxEvidence * 0.3));
  const kept = candidates.filter((c) => c.breakdown.evidence >= cutoff);

  const topK = opts.factTopK ?? cfg.factTopK;
  const factual = pickDiverse(kept, topK);

  // ---- 情绪通道：概率表 + 抽样 ----
  // 心情要随时间回落。抄自 dsh-feiyu-mood：事件把它推上去，时间把它拉回来。
  // 不这么做的话，两个月前那场气会一直挂在脸上——那是 bug，不是记性好。
  const moodRow = db.prepare("SELECT valence, arousal, label, updated_at FROM mood_state WHERE id = 'current'").get();
  const MOOD_HALFLIFE_HOURS = 10;
  const mood = moodRow
    ? (() => {
        const hours = Math.max(0, (nowTs - Number(moodRow.updated_at ?? nowTs)) / 3_600_000);
        const keep = Math.pow(0.5, hours / MOOD_HALFLIFE_HOURS);
        const valence = Number((Number(moodRow.valence) * keep).toFixed(2));
        const arousal = Number((Number(moodRow.arousal) * keep).toFixed(2));
        // 衰减到很淡就归为平静，别再挂一个「发蔫」的标签
        const label = Math.abs(valence) < 0.08 && arousal < 0.12 ? "平静" : String(moodRow.label);
        return { valence, arousal, label };
      })()
    : null;

  const temperature = cfg.temperatureBase + cfg.temperatureArousalGain * (mood?.arousal ?? 0);
  const seed =
    opts.seedOverride ?? hashSeed(`${sessionId}|${new Date(nowTs).toDateString()}`);
  const rnd = mulberry32(seed);

  const pool = kept.slice(0, cfg.probabilisticPool);
  const probs = softmax(pool.map((c) => c.breakdown.total), temperature);
  const table = pool.map((c, i) => ({
    eventId: c.event.id,
    title: c.event.title,
    probability: round3(probs[i] ?? 0),
  }));

  let affective: AffectivePick | null = null;
  if (pool.length > 0) {
    const idx = sampleIndex(probs, rnd);
    const chosen = pool[idx];
    const anchorName = evidence.get(chosen.event.id)?.topAnchor ?? null;
    const anchorRec = anchorName ? index.byId.get(anchorName) : null;
    affective = {
      event: chosen.event,
      probability: round3(probs[idx] ?? 0),
      viaAnchor: anchorRec?.name ?? null,
    };
  }

  // ---- 冷存储：只给地址，不给正文 ----
  // 「想起有那么件事」很便宜（几十个 token），「想起那件事的细节」才贵。
  //
  // 两种情况下会递地址：
  //   1) 主库整体没把握，那翻翻底片可能有救；
  //   2) 主库答得挺顺，但底片里的关键词在主库这几条里根本没出现 ——
  //      说明问到的是另一件事，正需要那个地址。
  const bestEvidence = kept.length > 0 ? kept[0].breakdown.total : 0;
  const factualBlob = factual.map((c) => eventText(c.event)).join(" ");
  const mainCovered = [...queryGrams].filter((g) => factualBlob.includes(g)).length;
  const coldHints: ColdHint[] = findColdHints(db, query, 3)
    .filter((h) => {
      if (bestEvidence < cfg.wakeThreshold) return h.matchedKeywords.length > 0;
      // 只有当底片对这句话的覆盖超过主库时，才值得把地址递上去
      return h.matchedKeywords.length > mainCovered;
    })
    .slice(0, 1);

  // 明确要求「直接读」时才把正文拼进来（费 token，默认关闭）
  const wokenTexts: string[] = [];
  if (cfg.autoWakeContent) {
    for (const hint of coldHints) {
      const full = dereference(db, hint.address);
      if (full) wokenTexts.push(truncate(full.rawDetail.replace(/\n/g, " / "), 120));
    }
  }

  // 每次想起来，就更新一次「现在的感受」——但别刷太勤（同一件事一小时一次）
  try {
    for (const c of factual) {
      const e = c.event;
      const at = e.feltNow?.at ?? 0;
      if (Date.now() - at < 3_600_000) continue;
      const nowV = Number(e.affect?.valence ?? 0) * 0.6 + Number(mood?.valence ?? 0) * 0.15;
      const nowA = Number(e.affect?.arousal ?? 0) * 0.5;
      db.prepare("UPDATE events SET felt_now_valence = ?, felt_now_arousal = ?, felt_now_at = ? WHERE id = ?").run(
        nowV,
        nowA,
        Date.now(),
        e.id,
      );
      e.feltNow = { valence: nowV, arousal: nowA, at: Date.now() };
    }
  } catch {
    // 写不进去不影响这次回忆
  }

  // 同一件事被记了好几版时，只留最好的那条——剩下的重复内容只会挤掉别的记忆。
  const dedupeByTitle = <T extends { event: EventRow }>(list: T[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const it of list) {
      const key = String(it.event.title ?? "")
        .replace(/[，。！？；、\s]/g, "")
        .slice(0, 10);
      if (key.length > 0 && seen.has(key)) continue;
      if (key.length > 0) seen.add(key);
      out.push(it);
    }
    return out;
  };
  const factualDeduped = dedupeByTitle(factual);

  const contextBlock = renderContext(factualDeduped, affective, coldHints, wokenTexts, mood);
  const totalTokens = estimateTokens(contextBlock);

  return {
    query,
    seeds,
    activation,
    factual,
    // 排序视野：每条的分是怎么来的，给它自己看
    scored: (kept as Array<{ event: EventRow; breakdown?: Record<string, number> }>).slice(0, 8).map((c) => ({
      title: String(c.event.title ?? "").slice(0, 40),
      score: Number((c.breakdown as { total?: number } | undefined)?.total ?? 0),
      evidence: Number(c.breakdown?.evidence ?? 0),
      anchor: Number(c.breakdown?.anchorEvidence ?? 0),
      feeling: Number(c.breakdown?.arousalBonus ?? 0),
      strength: Number(c.event.strength ?? 1),
      mentions: Number(c.event.mentions ?? 1),
      pinned: Boolean(c.event.pinned),
      tier: String(c.event.tier ?? ""),
    })),    probabilityTable: table,
    affective,
    coldHints,
    mood,
    contextBlock,
    totalTokens,
    randomness: { seed, temperature: round3(temperature) },
  };
}

export function eventText(e: EventRow): string {
  return [e.title, e.detail, e.cause, e.effect, e.coreFragment, e.affect.summary, ...e.keyFacts]
    .filter(Boolean)
    .join(" ");
}

function pickDiverse(candidates: RecallCandidate[], k: number): RecallCandidate[] {
  const out: RecallCandidate[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const fingerprint = `${c.event.day}|${c.event.title.slice(0, 8)}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push(c);
    if (out.length >= k) break;
  }
  return out;
}

function renderContext(
  factual: RecallCandidate[],
  affective: AffectivePick | null,
  coldHints: ColdHint[],
  wokenTexts: string[],
  mood: { valence: number; arousal: number; label: string } | null,
): string {
  const lines: string[] = [];
  if (mood) {
    lines.push(`【心境】${mood.label}（valence ${mood.valence}, arousal ${mood.arousal}）`);
  }
  if (factual.length > 0) {
    lines.push("【记得的事】");
    for (const c of factual) {
      const e = c.event;
      const body = describeEvent(e);
      lines.push(`- （${periodLabel(e.ts, Date.now())}·${e.tier}）${body}${feelBoth(e, mood)}`);
    }
  }
  if (affective) {
    const e = affective.event;
    const via = affective.viaAnchor ? `想到${affective.viaAnchor}，` : "";
    lines.push("【浮现的】");
    lines.push(`- ${via}${e.affect.summary || e.title}`);
  }
  if (wokenTexts.length > 0) {
    lines.push("【底片正文】");
    for (const w of wokenTexts) lines.push(`- ${w}`);
  } else if (coldHints.length > 0) {
    lines.push("【更早的底片（只给地址，需要就说一声）】");
    for (const h of coldHints) lines.push(`- ${h.address}：${h.gist}`);
  }
  return lines.join("\n");
}

/**
 * 把时间说成人话（抄自 dsh-fish-memory 的「每条记忆带时间」）。
 *
 * 「2026-10-12」对模型没用，「上周」「去年 9 月」才有用——
 * 因为人是这么记事的，模型也只有这么才分得清先后。
 */
export function relativeDayLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const dayMs = 86_400_000;
  const startOf = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(n) - startOf(d)) / dayMs);

  if (diffDays <= 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays === 2) return "前天";
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;

  const sameYear = d.getFullYear() === n.getFullYear();
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  if (sameYear) return diffDays < 60 ? `${Math.floor(diffDays / 30)} 个月前` : md;
  return `去年${md}`;
}

export function describeEvent(e: EventRow): string {
  const trim = (s: string) => s.replace(/[。！？\s]+$/, "");
  const when = relativeDayLabel(e.ts);
  const body =
    e.tier === "detailed"
      ? (() => {
          const head = trim(e.detail ?? e.title);
          return e.effect ? `${head}；后来${trim(e.effect)}` : head;
        })()
      : e.tier === "compressed"
        ? (() => {
            // 标题必须带上：压缩掉正文之后，标题往往是唯一还留着「初试」「良性」这类关键词的地方
            const title = trim(e.title);
            const core = e.coreFragment ? trim(e.coreFragment) : null;
            const effect = e.effect ? trim(e.effect).replace(/^后来/, "") : null;
            const parts = [
              e.cause ? `起因是${trim(e.cause)}` : null,
              core && !title.includes(core) ? core : null,
              effect ? `后来${effect}` : null,
            ].filter(Boolean);
            return parts.length > 0 ? `${title}｜${parts.join("；")}` : title;
          })()
        : `${trim(e.coreFragment || e.title)}（${e.affect.summary}）`;

  // 关键事实单独列出来：它是任何一层都不许丢的东西，值得占那几个字
  const facts = e.keyFacts.length > 0 ? `〔事实：${e.keyFacts.join("、")}〕` : "";
  const repeat = e.mentions > 1 ? `〔提过${e.mentions}次〕` : "";
  return `${when}｜${body}${facts}${repeat}`;
}

export function getEventSafe(db: DatabaseSync, id: string): EventRow | null {
  return getEvent(db, id);
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function dominantMood(events: EventRow[]): { valence: number; arousal: number; label: string } {
  if (events.length === 0) return { valence: 0, arousal: 0, label: moodLabel(0, 0) };
  const v = clamp(events.reduce((a, e) => a + e.affect.valence * e.affect.arousal, 0) / events.length, -1, 1);
  const a = clamp(events.reduce((x, e) => x + e.affect.arousal, 0) / events.length, 0, 1);
  return { valence: Math.round(v * 100) / 100, arousal: Math.round(a * 100) / 100, label: moodLabel(v, a) };
}



/**
 * 「当时」和「现在」分开说。
 *
 * 一件事当时的感受不会变；但每次想起来，现在的心情会掺进去。
 * 混成一个值，它以后就会用后来的平静冒充当时的难受。
 */
function feelBoth(
  e: { affect: { valence: number; arousal: number }; feltNow?: { valence: number; arousal: number } },
  mood: { valence: number; arousal: number } | null,
): string {
  const atV = Number(e.affect?.valence ?? 0);
  const atA = Number(e.affect?.arousal ?? 0);
  if (Math.abs(atV) < 0.15 && atA < 0.2) return "";

  const word = (v: number, a: number): string =>
    a < 0.3 ? "淡" : v <= -0.4 ? "难受" : v >= 0.4 ? "好受" : "说不上";

  // 现在想起来：原来的强度按现在心境半衰
  const nowV = e.feltNow ? Number(e.feltNow.valence) : atV * (mood ? 0.6 : 0.8) + (mood?.valence ?? 0) * 0.15;
  const nowA = e.feltNow ? Number(e.feltNow.arousal) : atA * (mood ? 0.5 : 0.7);

  return `〔当时${word(atV, atA)}，现在想起来${word(nowV, nowA)}〕`;
}


/**
 * 一条记忆「有多值得被想起来」。
 *
 * 不看相关度——那个已经算过了。这里只看**这条记忆本身干不干净**：
 * 有没有关键事实、正文够不够长、是不是半截话、是不是在聊「这件事本身」。
 */
function qualityOf(e: EventRow): number {
  let q = 1;

  // 有关键事实的明显更值钱（金额、日期、结论都在里面）
  const facts = Array.isArray(e.keyFacts) ? e.keyFacts.length : 0;
  if (facts > 0) q *= 1 + Math.min(0.4, facts * 0.12);

  // 太短的往往是半截话
  const len = String(e.detail ?? "").length;
  if (len < 10) q *= 0.55;
  else if (len < 25) q *= 0.8;

  // 以标点开头、或标题是「X是什么」这种，多半是断句碎片
  const title = String(e.title ?? "").trim();
  if (/^[，。！？；、]/.test(title)) q *= 0.5;
  if (/是什么$|什么意思$/.test(title)) q *= 0.75;

  // 「A；后来B」这种缝起来的，是两条不相干的事被压成一条，重罚
  if (/；后来/.test(String(e.detail ?? ""))) q *= 0.55;

  // 太长的正文多半是把整段对话倒进来了，不是一条事
  if (len > 180) q *= 0.75;

  // 标题太长也不像一条干净的记忆
  if (title.length > 30) q *= 0.85;

  return q;
}
