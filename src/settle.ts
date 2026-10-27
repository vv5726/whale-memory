import type { DatabaseSync } from "node:sqlite";

/**
 * 取舍：她自己定的标准。
 *
 * 「重复的、没结论的、被后来事实推翻的，标上失效时间沉下去。」
 * 这三条是她自己归纳的，比任何通用规则都对——因为是从她的数据里看出来的。
 *
 * 重要：**不删**。
 *   重复的   → 归档，留最完整那条
 *   没结论的 → 降级成 compressed（过程还有信息量，只是不值得占 detailed）
 *   被推翻的 → 打 invalid_at，保留——将来要回答「当时以为是什么」还得靠它
 */
export type Verdict = "keep" | "duplicate" | "inconclusive" | "superseded" | "noise";

export interface SettleReport {
  duplicate: number;
  inconclusive: number;
  superseded: number;
  noise: number;
}

/** 一眼看出是不是「聊了但没结果」 */
function looksInconclusive(text: string): boolean {
  const t = String(text ?? "");
  if (/决定|定了|确定|最后|结论|结果/.test(t)) return false;
  return /再想想|考虑一下|再说吧|不一定|可能|也许|看情况|待定|回头再|以后再说/.test(t);
}

/** 一眼看出是不是同一条的多余版本：标题前 8 字相同且正文高度相似 */
function sigOf(title: string, detail: string): string {
  const t = String(title ?? "").replace(/[，。！？；、\s]/g, "");
  const d = String(detail ?? "").replace(/[，。！？；、\s]/g, "");
  return `${t.slice(0, 8)}|${d.slice(0, 12)}`;
}

export function settle(db: DatabaseSync): SettleReport {
  const rows = db
    .prepare("SELECT id, title, detail, key_facts, ts FROM events WHERE archived = 0 AND (verdict = '' OR verdict IS NULL)")
    .all() as Array<{ id: string; title: string; detail: string; key_facts: string; ts: number }>;

  const report: SettleReport = { duplicate: 0, inconclusive: 0, superseded: 0, noise: 0 };
  const seen = new Map<string, { id: string; score: number }>();

  const score = (r: { title: string; detail: string; key_facts: string }): number => {
    let kf = 0;
    try {
      kf = (JSON.parse(r.key_facts || "[]") as string[]).length;
    } catch {
      kf = 0;
    }
    return kf * 2 + Math.min(30, String(r.detail).length) / 10;
  };

  for (const r of rows) {
    const sig = sigOf(r.title, r.detail);
    const s = score(r);
    const prev = seen.get(sig);

    // ① 重复：同一签名，留分高的
    if (prev) {
      if (s > prev.score) {
        db.prepare("UPDATE events SET archived = 1, verdict = ?, verdict_reason = ? WHERE id = ?").run(
          "duplicate",
          "同一件事的另一个版本，已被更完整的那条取代",
          prev.id,
        );
        seen.set(sig, { id: r.id, score: s });
      } else {
        db.prepare("UPDATE events SET archived = 1, verdict = ?, verdict_reason = ? WHERE id = ?").run(
          "duplicate",
          "同一件事的另一个版本，内容不如已有的那条完整",
          r.id,
        );
        report.duplicate += 1;
        continue;
      }
      report.duplicate += 1;
    } else {
      seen.set(sig, { id: r.id, score: s });
    }

    // ② 没结论：降级，不归档
    if (looksInconclusive(`${r.title} ${r.detail}`)) {
      db.prepare("UPDATE events SET tier = 'compressed', verdict = ?, verdict_reason = ? WHERE id = ?").run(
        "inconclusive",
        "聊了但没定下来，降级留着",
        r.id,
      );
      report.inconclusive += 1;
      continue;
    }

    db.prepare("UPDATE events SET verdict = ?, verdict_reason = ? WHERE id = ?").run("keep", "", r.id);
  }

  return report;
}
