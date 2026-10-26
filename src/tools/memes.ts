import { loadKb } from "../knowledge.ts";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 最近学过的热梗。
 *
 * 为什么单开一个工具：
 *  - 热梗是有保质期的，靠「印象」用出去一定会用上过气梗；
 *  - 知识库里 category=热梗 的条目带 source（BV 号 + 日期），能算出还剩几天；
 *  - 提示词不该把几十条梗全塞进去（token 爆炸），要用的时候查一下就行。
 */
const MEME_CATEGORY = "热梗";

/** 从 source 里抠出 2026-10-26 这种日期；抠不到就当「不知道哪天学的」 */
function sourceDay(source: string): string {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(source);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function daysBetween(day: string): number | null {
  if (!day) return null;
  const t = Date.parse(`${day}T00:00:00`);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function registerMemeTools(registry: ToolRegistry, hooks: { dataDir: string }): void {
  const tool: ToolDefinition = {
    name: "memes_recent",
    description:
      "查你最近学过的热梗（知识库 category=热梗）。用梗之前先查一下：有哪些、哪天学的、是不是快过气了。可以按关键词或场景筛。",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "只看最近几天学的（默认 21 天）" },
        query: { type: "string", description: "按标题/内容/场景筛，比如「哄人」「自嘲」「阴阳」" },
      },
    },
    handler: async (args) => {
      const days = Number(args.days ?? 21);
      const query = String(args.query ?? "").trim();
      const entries = loadKb(hooks.dataDir).entries.filter((e) => e.category === MEME_CATEGORY);

      const rows = entries
        .map((e) => {
          const day = sourceDay(String(e.source ?? ""));
          const age = daysBetween(day);
          const text = `${e.title} ${e.content}`;
          return { e, day, age, text };
        })
        .filter((r) => r.age === null || r.age <= days)
        .filter((r) => (query ? r.text.includes(query) : true))
        .sort((a, b) => (b.day > a.day ? 1 : -1));

      if (rows.length === 0) {
        return {
          ok: true,
          text: entries.length === 0
            ? "还没学过热梗。想学就用 bili_search 搜「热梗」「梗合集」，学到后用 kb_add 存（category 填「热梗」，source 写 BV 号和日期）。"
            : `最近 ${days} 天里没有${query ? `匹配「${query}」的` : ""}新梗（库里有 ${entries.length} 条，可能都旧了）。`,
        };
      }

      const lines: string[] = [`最近 ${days} 天内学到 ${rows.length} 条热梗：`];
      for (const r of rows.slice(0, 15)) {
        const age = r.age === null ? "日期不明" : r.age === 0 ? "今天" : `${r.age} 天前`;
        const stale = r.age !== null && r.age > 14 ? "（快过气了）" : "";
        lines.push(`- ${r.e.title}｜${age}${stale}｜${String(r.e.content ?? "").replace(/\s+/g, " ").slice(0, 80)}`);
      }
      if (rows.length > 15) lines.push(`（还有 ${rows.length - 15} 条，用 query 缩小范围）`);
      lines.push("", "用之前看一眼日期：超过两周的基本别用了。");
      return { ok: true, text: lines.join("\n") };
    },
  };
  registry.register(tool);
}
