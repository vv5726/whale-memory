import type { DatabaseSync } from "node:sqlite";
import { rowToEvent, tierTotals } from "./db.ts";
import { describeEvent } from "./recall.ts";
import { writeFileSync } from "node:fs";
import { padEnd, periodLabel } from "./util.ts";

/** 人可读视图：睡不着的时候可以自己翻一遍，检查压缩有没有把要紧的事删掉。 */
export function exportMarkdown(db: DatabaseSync, outPath: string): { events: number; bytes: number } {
  const rows = db
    .prepare("SELECT * FROM events ORDER BY ts DESC, created_at DESC")
    .all()
    .map((r) => rowToEvent(r as Record<string, unknown>));

  const totals = tierTotals(db);
  const lines: string[] = [];
  lines.push("# 记忆快照");
  lines.push("");
  lines.push(`导出于 ${new Date().toISOString()}`);
  lines.push("");
  lines.push("| 层 | 条数 | token |");
  lines.push("| --- | ---: | ---: |");
  for (const tier of ["detailed", "compressed", "fossil"] as const) {
    lines.push(`| ${tier} | ${totals[tier].count} | ${totals[tier].tokens} |`);
  }
  lines.push("");
  lines.push("> detailed = 清晰+感受；compressed = 只剩前因后果+感受+核心片段；fossil = 只剩感受+一个片段。");
  lines.push("");

  let currentDay = "";
  for (const e of rows) {
    if (e.day !== currentDay) {
      currentDay = e.day;
      lines.push(`## ${e.day} · ${periodLabel(e.ts, Date.now())}`);
      lines.push("");
    }
    lines.push(`### ${e.pinned ? "📌 " : ""}${e.title}`);
    lines.push("");
    const cold = e.archived
      ? (db.prepare("SELECT address FROM cold_archive WHERE event_id = ?").get(e.id)?.address as string | undefined)
      : undefined;
    lines.push(
      `- 层：\`${e.tier}\`　token：${e.sizeTokens}${cold ? `　原文在 ${cold}（deref 可取）` : e.archived ? "　（原文已进冷存储）" : ""}`,
    );
    lines.push(`- 内容：${describeEvent(e)}`);
    if (e.cause || e.effect) {
      lines.push(`- 前因后果：${[e.cause, e.effect].filter(Boolean).join(" → ")}`);
    }
    lines.push(`- 感受：${e.affect.summary || "（无）"}　valence ${e.affect.valence} / arousal ${e.affect.arousal}`);
    lines.push("");
  }

  const body = lines.join("\n");
  writeFileSync(outPath, body, "utf8");
  return { events: rows.length, bytes: Buffer.byteLength(body, "utf8") };
}

/** 终端里的简洁表格，status 用。 */
export function renderStatusTable(totals: Record<string, { count: number; tokens: number }>, budget: number, quotas: { detailed: number; compressed: number }): string {
  const lines: string[] = [];
  lines.push(`${padEnd("层", 12)}${padEnd("条数", 8)}${padEnd("token", 10)}占预算`);
  for (const tier of ["detailed", "compressed", "fossil"]) {
    const t = totals[tier];
    const share = budget > 0 ? t.tokens / budget : 0;
    lines.push(`${padEnd(tier, 12)}${padEnd(String(t.count), 8)}${padEnd(String(t.tokens), 10)}${(share * 100).toFixed(1)}%`);
  }
  const used = Object.values(totals).reduce((a, t) => a + t.tokens, 0);
  lines.push(`${padEnd("合计", 12)}${padEnd(String(Object.values(totals).reduce((a, t) => a + t.count, 0)), 8)}${padEnd(String(used), 10)}${budget > 0 ? ((used / budget) * 100).toFixed(1) : "0.0"}%`);
  lines.push("");
  lines.push(`配额：detailed ≤ ${(quotas.detailed * 100).toFixed(0)}%　compressed ≤ ${(quotas.compressed * 100).toFixed(0)}%　其余归 fossil`);
  return lines.join("\n");
}
