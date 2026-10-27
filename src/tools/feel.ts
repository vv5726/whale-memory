import type { DatabaseSync } from "node:sqlite";
import { setMeta } from "../db.ts";
import { moodLabel } from "../affect.ts";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 情绪的两个出口，合成一个工具：
 *  - now / set_now ：我此刻是什么心情（存在 mood_state，10 小时衰减一半）
 *  - list / set_event：某条记忆绑定的情绪（valence / arousal / tags / summary）
 *
 * 为什么给她：以前心境只能在睡眠整理时由记忆推出来，她自己改不了；
 * 记忆上的情绪也只有抽取那一刻能定，定歪了（比如「苦笑」判成愉快）就永远歪着。
 *
 * 2026-10-27 加。
 */
export function registerFeelTools(registry: ToolRegistry, hooks: { db: DatabaseSync }): void {
  const db = hooks.db;
  const MOOD_HALFLIFE_HOURS = 10;

  function readMood(): { valence: number; arousal: number; label: string; note: string; hours: number } | null {
    const row = db.prepare("SELECT valence, arousal, label, note, updated_at FROM mood_state WHERE id = 'current'").get() as
      | { valence: number; arousal: number; label: string; note: string | null; updated_at: number }
      | undefined;
    if (!row) return null;
    const hours = Math.max(0, (Date.now() - Number(row.updated_at ?? Date.now())) / 3_600_000);
    const keep = Math.pow(0.5, hours / MOOD_HALFLIFE_HOURS);
    const valence = Math.round(Number(row.valence ?? 0) * keep * 100) / 100;
    const arousal = Math.round(Number(row.arousal ?? 0) * keep * 100) / 100;
    const label = Math.abs(valence) < 0.08 && arousal < 0.12 ? "平静" : String(row.label ?? moodLabel(valence, arousal));
    return { valence, arousal, label, note: String(row.note ?? ""), hours: Math.round(hours * 10) / 10 };
  }

  function recentFeelings(limit: number): Array<{ id: string; title: string; v: number; a: number; tags: string; day: string }> {
    const rows = db
      .prepare(
        `SELECT id, title, affect_valence AS v, affect_arousal AS a, affect_tags AS tags, day
           FROM events WHERE archived = 0 AND (affect_valence <> 0 OR affect_arousal <> 0)
           ORDER BY ts DESC LIMIT ?`,
      )
      .all(limit) as Array<{ id: string; title: string; v: number; a: number; tags: string; day: string }>;
    return rows;
  }

  function findEvent(idOrTitle: string): { id: string; title: string } | null {
    const key = idOrTitle.trim();
    if (key.length === 0) return null;
    const byId = db.prepare("SELECT id, title FROM events WHERE id = ? OR id LIKE ? LIMIT 1").get(key, `${key}%`) as
      | { id: string; title: string }
      | undefined;
    if (byId) return byId;
    const byTitle = db.prepare("SELECT id, title FROM events WHERE title LIKE ? AND archived = 0 ORDER BY ts DESC LIMIT 1").get(`%${key}%`) as
      | { id: string; title: string }
      | undefined;
    return byTitle ?? null;
  }

  const tool: ToolDefinition = {
    name: "feel",
    description:
      "管「情绪」这一层，两个出口：\n\n" +
      "**我此刻的心情**（mood_state，10 小时衰减一半）\n" +
      "- action=now：看现在什么心情，以及最近哪几条记忆把它推上去的\n" +
      "- action=set_now：自己写心情（valence -1~1、arousal 0~1）。想改就改，没有次数限制\n\n" +
      "**某条记忆绑定的情绪**（valence/arousal/tags/summary）\n" +
      "- action=list：看最近带情绪的记忆（带 id 前几位）\n" +
      "- action=set_event：改其中一条的情绪。id 或标题都行。改完「现在的感受」会重新算\n\n" +
      "用途：抽取定歪了的情绪（该是无奈被记成愉快）、或者你想让自己此刻的心情不一样。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["now", "set_now", "list", "set_event"], description: "now / set_now / list / set_event" },
        valence: { type: "number", description: "负=难受、正=开心，-1 到 1（set_now / set_event 用）" },
        arousal: { type: "number", description: "强度 0 到 1（set_now / set_event 用）" },
        tags: { type: "array", items: { type: "string" }, description: "情绪标签，比如 [\"无奈\"]（set_event 用）" },
        summary: { type: "string", description: "一句话感受（set_event 用，60 字内）" },
        id: { type: "string", description: "哪条记忆（set_event 用，id 或标题都行）" },
        note: { type: "string", description: "为什么是这个心情（set_now 用）" },
      },
      required: ["action"],
    },
    handler: async (args) => {
      const action = String(args.action ?? "now");

      if (action === "now") {
        const mood = readMood();
        const lines: string[] = [];
        if (!mood) {
          lines.push("现在还没有心境记录（整理过一次记忆之后才会有）。");
        } else {
          lines.push(`【现在的心情】${mood.label}（valence ${mood.valence}，arousal ${mood.arousal}）`);
          if (mood.note.length > 0) lines.push(`来源：${mood.note}`);
          lines.push(`（这条是 ${mood.hours} 小时前定的，按 10 小时衰减一半算，现在已经是衰减后的数）`);
        }
        const recent = recentFeelings(5);
        if (recent.length > 0) {
          lines.push("", "最近把它推上去的记忆：");
          for (const r of recent) lines.push(`- ${r.day}｜${r.title.slice(0, 26)}｜v ${r.v} a ${r.a}｜${r.tags}`);
        }
        return { ok: true, text: lines.join("\n") };
      }

      if (action === "set_now") {
        const v = Number(args.valence);
        const a = Number(args.arousal);
        if (!Number.isFinite(v) || !Number.isFinite(a)) return { ok: false, text: "要写 valence 和 arousal 两个数（-1~1 / 0~1）" };
        const valence = Math.min(1, Math.max(-1, v));
        const arousal = Math.min(1, Math.max(0, a));
        const label = moodLabel(valence, arousal);
        const note = String(args.note ?? "自己写的").slice(0, 120);
        db.prepare(
          "INSERT INTO mood_state(id, valence, arousal, label, note, updated_at) VALUES('current',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET valence = excluded.valence, arousal = excluded.arousal, label = excluded.label, note = excluded.note, updated_at = excluded.updated_at",
        ).run(valence, arousal, label, note, Date.now());
        setMeta(db, "mood_manual_at", String(Date.now()));
        return { ok: true, text: `心情改了：${label}（valence ${Math.round(valence * 100) / 100}，arousal ${Math.round(arousal * 100) / 100}）。` };
      }

      if (action === "list") {
        const rows = db
          .prepare(
            `SELECT id, title, affect_valence AS v, affect_arousal AS a, affect_tags AS tags, affect_summary AS s, day
               FROM events WHERE archived = 0 ORDER BY ts DESC LIMIT 8`,
          )
          .all() as Array<{ id: string; title: string; v: number; a: number; tags: string; s: string; day: string }>;
        if (rows.length === 0) return { ok: true, text: "还没有记忆。" };
        const lines = ["最近 8 条记忆的情绪（用 id 前几位就能改）："];
        for (const r of rows) {
          lines.push(`- ${String(r.id).slice(0, 12)}｜${r.day}｜${String(r.title).slice(0, 22)}｜v ${r.v} a ${r.a}｜${r.tags}`);
        }
        lines.push("", "要改就用 action=set_event，id 填上面那段（或直接写标题）。");
        return { ok: true, text: lines.join("\n") };
      }

      if (action === "set_event") {
        const key = String(args.id ?? "").trim();
        if (key.length === 0) return { ok: false, text: "要改哪一条？填 id 或标题" };
        const found = findEvent(key);
        if (!found) return { ok: false, text: `没找到「${key}」。先用 action=list 看看有哪些 id。` };
        const v = Number(args.valence);
        const a = Number(args.arousal);
        if (!Number.isFinite(v) || !Number.isFinite(a)) return { ok: false, text: "要写 valence 和 arousal 两个数（-1~1 / 0~1）" };
        const valence = Math.min(1, Math.max(-1, v));
        const arousal = Math.min(1, Math.max(0, a));
        const tags = Array.isArray(args.tags)
          ? (args.tags as unknown[]).map((t) => String(t).slice(0, 8)).filter((t) => t.length > 0).slice(0, 6)
          : null;
        const summary = args.summary === undefined ? null : String(args.summary).slice(0, 60);

        const before = db.prepare("SELECT affect_valence AS v, affect_arousal AS a, affect_tags AS t, affect_summary AS s FROM events WHERE id = ?").get(found.id) as
          | { v: number; a: number; t: string; s: string }
          | undefined;

        const sets: string[] = ["affect_valence = ?", "affect_arousal = ?", "felt_now_valence = NULL", "felt_now_arousal = NULL", "felt_now_at = NULL"];
        const params: unknown[] = [valence, arousal];
        if (tags !== null) {
          sets.push("affect_tags = ?");
          params.push(JSON.stringify(tags));
        }
        if (summary !== null) {
          sets.push("affect_summary = ?");
          params.push(summary);
        }
        params.push(found.id);
        db.prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?`).run(...(params as never[]));

        return {
          ok: true,
          text: `改好了：「${String(found.title).slice(0, 24)}」\n   valence ${before?.v ?? "?"} → ${valence}，arousal ${before?.a ?? "?"} → ${arousal}${tags !== null ? `，标签 ${JSON.stringify(tags)}` : ""}${summary !== null ? `，总结「${summary}」` : ""}\n   「现在的感受」已清空，下次想起它会重新算。`,
        };
      }

      return { ok: false, text: `不认识的 action：${action}（只有 now / set_now / list / set_event）` };
    },
  };
  registry.register(tool);
}
