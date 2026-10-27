import type { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dayKey } from "./util.ts";

/**
 * 把记忆导成 markdown——给人看的，不是给程序看的。
 *
 * 存在的理由：记忆藏在 SQLite 里，你自己看不见。
 * 看不见的东西没法判断它对不对，也没法亲手改。
 * 导出来之后，它就是一堆能直接读、能直接改的文本。
 */
export function exportMemoryMarkdown(db: DatabaseSync, dataDir: string, nowTs = Date.now()): string {
  const rows = db
    .prepare(
      `SELECT kind, title, detail, key_facts, speaker_id, day, tier, affect_valence, affect_arousal
       FROM events WHERE archived = 0 ORDER BY kind, ts DESC`,
    )
    .all() as Array<{
    kind: string;
    title: string;
    detail: string;
    key_facts: string;
    speaker_id: string;
    day: string;
    tier: string;
    affect_valence: number;
    affect_arousal: number;
  }>;

  const groups: Record<string, string[]> = {
    user: ["# 关于他", "他说过自己是谁、喜欢什么。这些每轮都会出现在我眼前。\n"],
    feedback: ["# 他定过的规矩", "这些不能忘——今天想不起来「他要我进修」，我就真的不会去。\n"],
    project: ["# 项目", "我们在做的事，做到哪一步。\n"],
    reference: ["# 外部指针", "文档、链接、仓库。\n"],
    event: ["# 发生过的事", "按时间倒序。可能不完整、可能有偏差。\n"],
  };

  const people: Record<string, string> = {};
  try {
    const ps = db.prepare("SELECT qq_id, display_name FROM people").all() as Array<{
      qq_id: string;
      display_name: string;
    }>;
    for (const p of ps) people[p.qq_id] = p.display_name || p.qq_id;
  } catch {
    // 没有 people 表就跳过
  }

  for (const r of rows) {
    const kind = groups[r.kind] ? r.kind : "event";
    const who = r.speaker_id ? `　·　${people[r.speaker_id] ?? r.speaker_id}` : "";
    let facts = "";
    try {
      const kf = JSON.parse(r.key_facts || "[]") as string[];
      if (Array.isArray(kf) && kf.length > 0) facts = `\n  〔事实：${kf.join("、")}〕`;
    } catch {
      // 忽略坏数据
    }
    const feel =
      Math.abs(Number(r.affect_valence ?? 0)) >= 0.3 || Number(r.affect_arousal ?? 0) >= 0.4
        ? `　（当时${Number(r.affect_valence) <= -0.4 ? "难受" : Number(r.affect_valence) >= 0.4 ? "好受" : "说不上"}）`
        : "";
    const body = String(r.detail ?? "").replace(/\s+/g, " ").trim();
    groups[kind]!.push(`## ${r.title}　〔${r.day}${who}${feel}〕\n\n${body}${facts}\n`);
  }

  const parts = [`# 凝的记忆 · ${dayKey(nowTs)}`, "", `共 ${rows.length} 条。这是自动导出的快照，改了不会回写数据库。`, ""];
  for (const key of ["user", "feedback", "project", "reference", "event"]) {
    const g = groups[key]!;
    if (g.length > 1) parts.push(...g, "");
  }

  const dir = join(dataDir, "memory-export");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${dayKey(nowTs)}.md`);
  writeFileSync(file, parts.join("\n"), "utf8");
  return file;
}
