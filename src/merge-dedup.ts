import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 合并，不是丢弃 —— 而且合并前让本地的 8b 当裁判。
 *
 * 为什么需要裁判：粗筛只看标题的 2 字组，主语一样就算相似，
 * 「他说账号归谁」和「他说没调参数」会被判成同一件事，合起来就成浆糊。
 * 8b 读的是两条正文，问它「是不是同一件事」，它答不对就不合。
 */
const OLLAMA = "http://127.0.0.1:11434";
const JUDGE_MODEL = "qwen3:8b";

export interface MergeResult {
  groups: number;
  merged: number;
  skipped: number;
  kept: number;
  preview: Array<{ title: string; from: number; to: string; verdict: string; reason: string }>;
}

async function judge(a: { title: string; detail: string }, b: { title: string; detail: string }): Promise<{ same: boolean; reason: string }> {
  const prompt = [
    "下面两条记忆，是不是记的同一件事？",
    "",
    `甲：${String(a.title).slice(0, 40)}`,
    `${String(a.detail).slice(0, 220)}`,
    "",
    `乙：${String(b.title).slice(0, 40)}`,
    `${String(b.detail).slice(0, 220)}`,
    "",
    "只按这个格式回两行：",
    "判定：是 或 否",
    "理由：一句话，不超过二十字",
  ].join("\n");

  try {
    const res = await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: JUDGE_MODEL, prompt, stream: false, options: { temperature: 0 } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { same: false, reason: "裁判没答上来" };
    const json = (await res.json()) as { response?: string };
    const t = String(json.response ?? "");
    const verdict = /判定[：:]\s*([是否])/.exec(t)?.[1];
    const reason = /理由[：:]\s*(.+)/.exec(t)?.[1]?.trim() ?? "";
    return { same: verdict === "是", reason: reason.slice(0, 40) || (verdict === "是" ? "同一件事" : "不是同一件事") };
  } catch {
    return { same: false, reason: "裁判超时，先不合" };
  }
}

function mergeTexts(texts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const views: string[] = [];

  for (const t of texts) {
    const text = String(t ?? "");
    if (text.trim().length === 0 || text.trim() === "null") continue;

    // 「我当时想」单独留：它跟正文重合度高，按普通句子去重会被误删
    const view = /〔我当时想：([\s\S]*?)〕/.exec(text)?.[1]?.trim();
    if (view && view.length > 0 && view !== "null") views.push(view);

    const body = text.replace(/〔我当时想：[\s\S]*?〕/g, "");
    for (const raw of body.split(/(?<=[。！？；\n])/)) {
      const s = raw.trim();
      if (s.length === 0 || s === "null") continue;
      const grams = new Set<string>();
      const c = s.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
      for (let i = 0; i + 3 <= c.length; i += 1) grams.add(c.slice(i, i + 3));
      let dup = false;
      for (const g of grams) if (seen.has(g)) { dup = true; break; }
      if (dup) continue;
      for (const g of grams) seen.add(g);
      out.push(s);
    }
  }

  const uniqViews = [...new Set(views.map((v) => v.replace(/\s+/g, " ").trim()))].filter(Boolean);
  if (uniqViews.length > 0) out.push(`〔我当时想：${uniqViews.join("；")}〕`);
  return out.join("");
}

function grams(t: string): Set<string> {
  const c = String(t).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
  const s = new Set<string>();
  for (let i = 0; i + 2 <= c.length; i += 1) s.add(c.slice(i, i + 2));
  return s;
}

function sim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit += 1;
  return hit / Math.min(a.size, b.size);
}

export async function mergeMemories(
  db: DatabaseSync,
  opts: { day?: string; threshold?: number; dryRun?: boolean; useJudge?: boolean } = {},
): Promise<MergeResult> {
  const threshold = Math.min(0.95, Math.max(0.4, opts.threshold ?? 0.55));
  const dryRun = opts.dryRun !== false;
  const useJudge = opts.useJudge !== false;

  const where = ["archived = 0"];
  const params: unknown[] = [];
  if (opts.day) {
    where.push("day = ?");
    params.push(opts.day);
  }

  const rows = db
    .prepare(`SELECT id, day, title, detail, key_facts, pinned, speaker_id FROM events WHERE ${where.join(" AND ")} ORDER BY day, ts`)
    .all(...(params as never[])) as Array<{
    id: string;
    day: string;
    title: string;
    detail: string;
    key_facts: string;
    pinned: number;
    speaker_id: string;
  }>;

  const score = (r: (typeof rows)[number]): number => {
    let s = 0;
    if (String(r.detail).includes("〔我当时想：")) s += 100;
    if (Number(r.pinned) === 1) s += 50;
    try {
      s += ((JSON.parse(r.key_facts || "[]") as string[]) ?? []).length * 5;
    } catch {
      /* 忽略 */
    }
    return s + Math.min(60, String(r.detail).length) / 2;
  };

  const byDay = new Map<string, Array<{ r: (typeof rows)[number]; g: Set<string> }>>();
  for (const r of rows) {
    const list = byDay.get(r.day) ?? [];
    list.push({ r, g: grams(r.title) });
    byDay.set(r.day, list);
  }

  const preview: MergeResult["preview"] = [];
  let groups = 0;
  let merged = 0;
  let skipped = 0;
  let kept = 0;

  for (const list of byDay.values()) {
    const used = new Set<string>();
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]!;
      if (used.has(a.r.id)) continue;
      const cluster = [a];
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j]!;
        if (used.has(b.r.id)) continue;
        if (sim(a.g, b.g) >= threshold) {
          cluster.push(b);
          used.add(b.r.id);
        }
      }
      if (cluster.length <= 1) {
        kept += 1;
        continue;
      }

      const sorted = [...cluster].sort((x, y) => score(y.r) - score(x.r));
      const winner = sorted[0]!.r;

      // ★ 裁判：逐条问「跟胜者是不是同一件事」，答否的不合
      const accepted: typeof rows = [];
      let lastReason = "";
      for (const c of sorted.slice(1)) {
        const loser = c.r;
        // 硬护栏：说话人不同，默认不合并
        if (loser.speaker_id && winner.speaker_id && loser.speaker_id !== winner.speaker_id) {
          skipped += 1;
          lastReason = "说话人不同";
          continue;
        }
        if (!useJudge) {
          accepted.push(loser);
          continue;
        }
        const v = await judge(winner, loser);
        if (v.same) {
          accepted.push(loser);
          lastReason = v.reason;
        } else {
          skipped += 1;
          lastReason = v.reason;
        }
      }

      if (accepted.length === 0) {
        kept += 1;
        if (lastReason) preview.push({ title: winner.title.slice(0, 26), from: cluster.length, to: "", verdict: "跳过", reason: lastReason });
        continue;
      }

      groups += 1;
      const mergedDetail = mergeTexts([winner.detail, ...accepted.map((l) => l.detail)]);
      const facts = new Set<string>();
      for (const x of [winner, ...accepted]) {
        try {
          for (const f of (JSON.parse(x.key_facts || "[]") as string[]) ?? []) facts.add(f);
        } catch {
          /* 忽略 */
        }
      }
      const longestTitle = [winner, ...accepted].map((x) => x.title).sort((p, q) => q.length - p.length)[0]!;

      preview.push({
        title: winner.title.slice(0, 26),
        from: cluster.length,
        to: mergedDetail.slice(0, 60),
        verdict: "合并",
        reason: lastReason || "同一件事",
      });
      kept += 1;
      merged += accepted.length;

      if (!dryRun) {
        db.prepare("UPDATE events SET title = ?, detail = ?, key_facts = ?, updated_at = ? WHERE id = ?").run(
          longestTitle.slice(0, 60),
          mergedDetail.slice(0, 1200),
          JSON.stringify([...facts]),
          Date.now(),
          winner.id,
        );
        for (const l of accepted) {
          db.prepare("UPDATE events SET archived = 1, verdict = 'merged', verdict_reason = ? WHERE id = ?").run(
            `已并入「${winner.title.slice(0, 20)}」，内容保留`,
            l.id,
          );
        }
      }
    }
  }

  return { groups, merged, skipped, kept, preview: preview.slice(0, 8) };
}

export function registerMergeTool(
  registry: ToolRegistry,
  hooks: { merge?: (o: { day?: string; threshold?: number; dryRun?: boolean; useJudge?: boolean }) => Promise<MergeResult> },
): void {
  const tool: ToolDefinition = {
    name: "memory_merge",
    description:
      "把说的是同一件事的记忆**合并**成一条（正文取各自独有的句子，关键事实取并集，想法全部保留）。\n\n合并前会让本地的 8b 逐条判「是不是同一件事」，判否的不合——所以不会把不相干的东西糊在一起。说话人不同的默认不合并。\n\n默认只预览，看清楚再传 dryRun: false 真做。",
    parameters: {
      type: "object",
      properties: {
        day: { type: "string", description: "只处理某一天（YYYY-MM-DD）" },
        threshold: { type: "number", description: "粗筛门槛 0.4-0.95，默认 0.55（只是候选，裁不裁由裁判定）" },
        dryRun: { type: "boolean", description: "true = 只预览（默认）；false = 真合并" },
        useJudge: { type: "boolean", description: "默认 true。false = 不叫裁判，只按粗筛合（快但可能糊）" },
      },
    },
    handler: async (args) => {
      if (!hooks.merge) return { ok: false, text: "现在做不了" };
      const r = await hooks.merge({
        day: args.day ? String(args.day) : undefined,
        threshold: args.threshold === undefined ? undefined : Number(args.threshold),
        dryRun: args.dryRun !== false,
        useJudge: args.useJudge !== false,
      });
      if (r.groups === 0 && r.skipped === 0) return { ok: true, text: "没有可以合并的。" };

      const lines = r.preview.map(
        (p) => `  [${p.verdict}] ${p.from} 条 → 「${p.title}」\n      裁判：${p.reason}${p.to ? `\n      合并后：${p.to}…` : ""}`,
      );
      return {
        ok: true,
        text: [
          `合并预览：可合 ${r.groups} 组（涉及 ${r.merged} 条），裁判拦下 ${r.skipped} 条`,
          ...lines,
          args.dryRun !== false ? "确认无误就再调一次，传 dryRun: false。" : "已合并完成。",
        ].join("\n"),
      };
    },
  };
  registry.register(tool);
}
