import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveTuning } from "../tuning.ts";
import { affectWordsSnapshot, initAffectWords } from "../affect.ts";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 「她自己能改的那堆文件」的统一入口。
 *
 * 原则：凡是她该有权改的，都要有工具；凡是有密钥/数据库的，一律不许碰。
 * 所以这里用**白名单**，不是黑名单——加新文件要显式写进来。
 *
 * 2026-10-27：list/read/write 合成一个带 action 的。
 */
const ALLOWED: Array<{ path: string; label: string; kind: "md" | "json" | "text"; max: number }> = [
  { path: "persona.md", label: "人格底色", kind: "md", max: 8000 },
  { path: "self.md", label: "自我描述", kind: "md", max: 8000 },
  { path: "think-prompt.md", label: "走神提示词", kind: "md", max: 8000 },
  { path: "speech-rules.md", label: "说话规矩", kind: "md", max: 6000 },
  { path: "extract-rules.md", label: "记忆抽取规矩", kind: "md", max: 6000 },
  { path: "tuning.json", label: "调参（温度/概率/走神旋钮/计划分值）", kind: "json", max: 4000 },
  { path: "affect-words.json", label: "情绪词表（默认词典之上叠加，disable 可关掉默认词）", kind: "json", max: 8000 },
  { path: "notes/pinned.md", label: "自己钉住的笔记", kind: "md", max: 8000 },
];

function find(path: string) {
  const key = String(path ?? "").replace(/\\/g, "/").replace(/^\.?\//, "");
  return ALLOWED.find((x) => x.path === key) ?? null;
}

export function registerDataFileTools(registry: ToolRegistry, hooks: { dataDir: string }): void {
  const tool: ToolDefinition = {
    name: "data_file",
    description:
      "读/改「你自己能改的那些文件」（人格底色、自我描述、走神提示词、说话规矩、抽取规矩、tuning.json、钉住的笔记）。\n\naction：list 看有哪些、read 读一个、write 整份覆盖一个。有密钥的东西（bot.json、数据库）不在名单里，碰不到。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "read", "write"], description: "list 看名单 / read 读 / write 写" },
        path: { type: "string", description: "文件名，例如 persona.md（action=read / write 时填）" },
        content: { type: "string", description: "action=write 时填：完整的新内容" },
      },
      required: ["action"],
    },
    handler: async (args) => {
      const action = String(args.action ?? "list");

      if (action === "list") {
        const lines = ["你能直接改的文件："];
        for (const f of ALLOWED) {
          const p = join(hooks.dataDir, f.path);
          let size = 0;
          try {
            size = existsSync(p) ? statSync(p).size : 0;
          } catch {
            size = 0;
          }
          lines.push(`- ${f.path}｜${f.label}｜${size > 0 ? `${size} 字节` : "还没建（写入就会创建）"}｜上限 ${f.max} 字`);
        }
        lines.push("", "读用 action=read，写用 action=write（整份覆盖）。有密钥的东西（bot.json、数据库）不在这个名单里。");
        return { ok: true, text: lines.join("\n") };
      }

      if (action === "read") {
        const f = find(String(args.path ?? ""));
        if (!f) return { ok: false, text: `不在名单里：${args.path}（先用 action=list 看看有哪些）` };
        const p = join(hooks.dataDir, f.path);
        if (!existsSync(p)) return { ok: true, text: `（${f.path} 还不存在；写一次就会创建）` };
        return { ok: true, text: readFileSync(p, "utf8") };
      }

      if (action === "write") {
        const f = find(String(args.path ?? ""));
        if (!f) return { ok: false, text: `不在名单里：${args.path}（先用 action=list 看看有哪些）` };
        const text = String(args.content ?? "");
        if (text.trim().length === 0) return { ok: false, text: "内容不能为空（想清空就直接说，我帮你删文件）" };
        if (text.length > f.max) return { ok: false, text: `太长了：${text.length} 字，上限 ${f.max}` };

        const p = join(hooks.dataDir, f.path);
        if (f.kind === "json") {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(text) as Record<string, unknown>;
          } catch (e) {
            return { ok: false, text: `不是合法 JSON：${e instanceof Error ? e.message : e}` };
          }
          if (f.path === "tuning.json") {
            const next = saveTuning(hooks.dataDir, parsed as never);
            return { ok: true, text: `写好了（已按范围收敛）。现在：${JSON.stringify(next)}` };
          }
          if (f.path === "affect-words.json") {
            // 立刻重载，下一句话的情绪打分就按新词表
            initAffectWords(hooks.dataDir);
            const snap = affectWordsSnapshot();
            return {
              ok: true,
              text: `写好了，已生效。现在正词 ${Object.keys(snap.positive).length} 个、负词 ${Object.keys(snap.negative).length} 个；来自你自己的 ${snap.fromFile.length} 个${snap.disabled.length > 0 ? `，关掉的默认词：${snap.disabled.join("、")}` : ""}。`,
            };
          }
          writeFileSync(p, JSON.stringify(parsed, null, 2), "utf8");
          return { ok: true, text: `写好了：${f.path}` };
        }
        writeFileSync(p, text, "utf8");
        return { ok: true, text: `写好了：${f.path}（${text.length} 字），下一次开口/走神就按这份来。` };
      }

      return { ok: false, text: `不认识的 action：${action}（只有 list / read / write）` };
    },
  };
  registry.register(tool);
}
