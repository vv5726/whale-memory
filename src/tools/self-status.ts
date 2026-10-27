import type { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolRegistry } from "./registry.ts";
import { tierTotals } from "../db.ts";
import { todayCost } from "../cost.ts";
import { pendingTurns } from "../sleep.ts";

/**
 * 「看自己一眼」的目录。
 *
 * 存在的理由：她本来就能看到自己的全部（人格、自我描述、规矩、参数、记忆数字），
 * 但散在十来个工具里，没有一个「抬头看自己」的入口；
 * 而且她**完全看不到自己今天花了多少钱**——todayCost() 只在代码里卡额度。
 *
 * 为什么给目录不给全文：人格 2100 字 + 自我 310 + 说话 890 + 抽取 570 + 走神 620
 * 加起来约 4500 字 ≈ 3200 token。工具结果在工具环里**每轮重发**，
 * 一次全吐会把记忆块（上限 1200 token）挤掉两倍半。
 * 所以这里只报「每块多少字」+ 今天的数字，想看哪块再用对应的工具取。
 */

const FILES: Array<{ label: string; file: string; how: string }> = [
  { label: "人格", file: "persona.md", how: "persona(action=get)" },
  { label: "自我描述", file: "self.md", how: "self_read" },
  { label: "说话规矩", file: "speech-rules.md", how: "speech(action=get)" },
  { label: "抽取规则", file: "extract-rules.md", how: "extract(action=get)" },
  { label: "走神提示词", file: "think-prompt.md", how: "think(action=prompt_get)" },
];

function charCount(path: string): number | null {
  try {
    if (!existsSync(path)) return null;
    return [...readFileSync(path, "utf8")].length;
  } catch {
    return null;
  }
}

export function selfStatusText(db: DatabaseSync, dataDir: string): string {
  const lines: string[] = [];

  // ① 我是谁：几份能改的文本，只报字数
  const who: string[] = [];
  for (const f of FILES) {
    const n = charCount(join(dataDir, f.file));
    who.push(n === null ? `${f.label}（没有）` : `${f.label} ${n} 字`);
  }
  lines.push(`【我是谁】${who.join("｜")}`);

  // ② 我怎么做事：参数个数 + 规则条数
  let tuningKeys = 0;
  try {
    const t = JSON.parse(readFileSync(join(dataDir, "tuning.json"), "utf8")) as Record<string, unknown>;
    tuningKeys = Object.keys(t).length;
  } catch {
    // 没有就报 0
  }
  let ruleLines = 0;
  try {
    const s = readFileSync(join(dataDir, "speech-rules.md"), "utf8");
    ruleLines = s.split("\n").filter((l) => /^\s*[-*·]\s+/.test(l)).length;
  } catch {
    // 读不到就算 0
  }
  lines.push(`【我怎么做事】参数 ${tuningKeys} 项｜说话规矩 ${ruleLines} 条｜工具见 tool_audit`);

  // ③ 我现在：记忆的分层、锚点、钉住、底片
  try {
    const t = tierTotals(db);
    const one = (sql: string): number => Number((db.prepare(sql).get() as { c?: number } | undefined)?.c ?? 0);
    const archived = one("SELECT COUNT(*) AS c FROM events WHERE archived = 1");
    lines.push(
      `【我现在】记忆 ${t.detailed.count + t.compressed.count + t.fossil.count} 条` +
        `（detailed ${t.detailed.count} / compressed ${t.compressed.count} / fossil ${t.fossil.count}）` +
        `｜占 ${t.detailed.tokens + t.compressed.tokens} token｜锚点 ${one("SELECT COUNT(*) AS c FROM anchors")}` +
        `｜钉住 ${one("SELECT COUNT(*) AS c FROM events WHERE pinned = 1")}｜底片 ${one("SELECT COUNT(*) AS c FROM cold_archive")}` +
        `｜归档 ${archived}`,
    );
    lines.push(`【还没整理】${pendingTurns(db)} 轮对话`);
  } catch (err) {
    lines.push(`【我现在】读不出来：${err instanceof Error ? err.message : String(err)}`);
  }

  // ④ 今天：花了多少、还剩多少（这一条以前完全没有）
  try {
    const c = todayCost();
    lines.push(
      `【今天】调用 ${c.calls} 次｜输入 ${c.promptTokens} / 输出 ${c.completionTokens} token` +
        `｜花 ¥${c.yuan}（缓存后 ¥${c.yuanWithCache}）` +
        (Number.isFinite(c.leftYuan) ? ` / 上限 ¥${c.budgetYuan}，还剩 ¥${c.leftYuan}` : "（不限）"),
    );
  } catch (err) {
    lines.push(`【今天】读不出来：${err instanceof Error ? err.message : String(err)}`);
  }

  lines.push(`【想看全文】${FILES.map((f) => f.how).join(" / ")} / memory_stats`);
  return lines.join("\n");
}

export function registerSelfStatusTools(
  registry: ToolRegistry,
  opts: { db: DatabaseSync; dataDir: string },
): void {
  registry.register({
    name: "self_status",
    description:
      "看自己一眼（**只给目录，不给全文**）：人格/自我描述/规矩各多少字、记忆分几层各多少条、锚点多少、今天调了多少次模型、花了多少钱、还剩多少。想看某个文件的全文，再用对应的工具取。",
    parameters: { type: "object", properties: {}, required: [] },
    handler: async () => {
      try {
        return { ok: true, text: selfStatusText(opts.db, opts.dataDir) };
      } catch (err) {
        return { ok: false, text: `读自己的状态失败：${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
}
