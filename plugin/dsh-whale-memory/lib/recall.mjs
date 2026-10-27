/**
 * 精简版检索 —— 纯 .mjs，不依赖任何 .ts，任何宿主的 Node 都能加载。
 *
 * 和主库 src/recall.ts 的区别：
 *   主库那版有软性回忆（情绪采样）、冷存储提示、情绪衰减曲线；
 *   这版只保留「证据」这条确定性通道——够用，而且快、稳、可预测。
 */

/** 这些词太常见，拿它们当线索会把无关的事全捞上来 */
const STOP = new Set([
  "什么", "今天", "现在", "这个", "那个", "我的", "你的", "他的", "她的", "一个", "一些",
  "就是", "因为", "所以", "可以", "怎么", "意思", "还好", "是不", "不是", "知道", "觉得",
  "我们", "你们", "他们", "时候", "东西", "事情", "是不", "没有", "有没", "的话", "是不",
  "为什", "么样", "了吗", "呢？", "是不", "还不", "不是",
]);

/** 把中文句子切成 2 字组，用来近似词 */
function bigrams(text) {
  const out = [];
  const clean = String(text ?? "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, " ");
  for (const seg of clean.split(/\s+/)) {
    if (!seg) continue;
    if (/^[a-zA-Z0-9]+$/.test(seg)) {
      out.push(seg.toLowerCase());
      continue;
    }
    for (let i = 0; i + 2 <= seg.length; i += 1) {
      const g = seg.slice(i, i + 2);
      if (!STOP.has(g)) out.push(g);
    }
  }
  return out.slice(0, 40);
}

/**
 * 检索。
 * @returns 可以直接塞进提示词的一段文字（没有相关记忆时返回空串）
 */
export function recallContext(db, query, opts = {}) {
  const now = Date.now();
  const limit = opts.limit ?? 5;
  const speakerId = opts.speakerId ?? "";
  const q = String(query ?? "").trim();
  if (q.length === 0) return "";

  // ① 命中的锚点：名字直接出现在问题里
  const hits = new Map(); // anchorId -> 权重
  try {
    const anchors = db.prepare("SELECT id, name FROM anchors").all();
    for (const a of anchors) {
      const name = String(a.name ?? "");
      if (name.length < 2) continue;
      if (q.includes(name)) hits.set(String(a.id), 1);
    }
  } catch {
    return "";
  }

  // ② 沿关系网扩散一层（算一半），再一层（算四分之一）
  try {
    const expand = (factor) => {
      if (hits.size === 0) return;
      const ids = [...hits.keys()];
      const ph = ids.map(() => "?").join(",");
      const rows = db
        .prepare(`SELECT src, dst, weight FROM edges WHERE src IN (${ph}) OR dst IN (${ph})`)
        .all(...ids, ...ids);
      for (const r of rows) {
        const w = Number(r.weight ?? 1);
        for (const [from, to] of [
          [r.src, r.dst],
          [r.dst, r.src],
        ]) {
          if (!hits.has(String(from))) continue;
          const next = String(to);
          const score = (hits.get(String(from)) ?? 0) * factor * Math.min(1, w);
          if (score > (hits.get(next) ?? 0)) hits.set(next, score);
        }
      }
    };
    expand(0.5);
    expand(0.25);
  } catch {
    // 没有关系网就算了
  }

  // ③ 候选事件：挂在命中锚点上的
  const scored = new Map(); // eventId -> score
  if (hits.size > 0) {
    const ids = [...hits.keys()];
    const ph = ids.map(() => "?").join(",");
    try {
      const rows = db
        .prepare(`SELECT event_id, anchor_id, weight FROM event_anchors WHERE anchor_id IN (${ph})`)
        .all(...ids);
      for (const r of rows) {
        const contribution = (hits.get(String(r.anchor_id)) ?? 0) * Number(r.weight ?? 1);
        const cur = scored.get(String(r.event_id)) ?? 0;
        scored.set(String(r.event_id), Math.max(cur, contribution));
      }
    } catch {
      // 表结构不对就退到纯字面
    }
  }

  // ④ 字面补偿：标题/正文里出现的 2 字组也算证据（防止锚点没抽到）
  const grams = bigrams(q);
  if (grams.length > 0) {
    try {
      const like = grams.slice(0, 8).map(() => "title LIKE ? OR detail LIKE ?").join(" OR ");
      const params = grams.slice(0, 8).flatMap((g) => [`%${g}%`, `%${g}%`]);
      const rows = db
        .prepare(`SELECT id FROM events WHERE archived = 0 AND (${like}) LIMIT 60`)
        .all(...params);
      for (const r of rows) {
        const cur = scored.get(String(r.id)) ?? 0;
        scored.set(String(r.id), Math.max(cur, 0.35));
      }
    } catch {
      // 忽略
    }
  }

  if (scored.size === 0) return "";

  // ⑤ 排序：证据 + 新鲜度 + 情绪 + 说话人
  const ids = [...scored.keys()].slice(0, 200);
  const ph = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, day, ts, tier, title, detail, key_facts, affect_valence, affect_arousal, pinned, speaker_id, archived
       FROM events WHERE id IN (${ph}) AND archived = 0`,
    )
    .all(...ids);

  const ranked = rows
    .map((e) => {
      let score = scored.get(String(e.id)) ?? 0;
      const ageDays = (now - Number(e.ts ?? now)) / 86_400_000;
      score += 0.2 * Math.exp(-ageDays / 30); // 新鲜度
      score += 0.1 * Math.abs(Number(e.affect_arousal ?? 0)); // 情绪强度
      if (e.pinned) score += 0.15;
      if (speakerId && e.speaker_id) score *= e.speaker_id === speakerId ? 1.25 : 0.75;
      return { ...e, score };
    })
    .filter((e) => e.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (ranked.length === 0) return "";

  // ⑥ 拼成一段话
  const lines = ranked.map((e) => {
    const when = String(e.day ?? "");
    const tier = e.tier === "detailed" ? "" : `·${e.tier}`;
    let body = String(e.detail ?? "").replace(/\s+/g, " ").trim();
    if (body.length > 160) body = `${body.slice(0, 160)}…`;
    let facts = "";
    try {
      const kf = JSON.parse(String(e.key_facts ?? "[]"));
      if (Array.isArray(kf) && kf.length > 0) facts = `〔事实：${kf.join("、")}〕`;
    } catch {
      // 忽略
    }
    return `- （${when}${tier}）${body}${facts}`;
  });

  return lines.join("\n");
}
