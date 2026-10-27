import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 只读的「看自己源码」入口。
 *
 * 为什么要有：她会问「我是怎么拼提示词的」「工具是怎么注册的」，
 * 与其让她猜，不如让她自己翻代码。
 *
 * 为什么是白名单：`data/` 里有 bot.json（API key）、memory.db，
 * `data/backup-…` 里还有备份的密钥副本。所以这里只放行**代码和文档**，
 * 而且只给「读」，不给写、不给列目录。
 */
const READABLE = [
  "docs/how-i-work.md",
  "docs/extraction.md",
  "docs/phone.md",
  "src/bot/service.ts",
  "src/bot/persona.ts",
  "src/bot/autonomy.ts",
  "src/llm/extract.ts",
  "src/llm/toolchat.ts",
  "src/extract-prompt.ts",
  "src/tools/index.ts",
];

const MAX_LINES = 300;
const MAX_CHARS = 16_000;

export function registerSourceTools(registry: ToolRegistry): void {
  const tool: ToolDefinition = {
    name: "source",
    description:
      "只读地看你自己的源码和说明文档（不是 data/ 里的数据）。\n\naction：list 看有哪些文件、各多少行；read 按行范围读一段。\n一次最多 300 行，从一个位置读（默认第 1 行起）。想看「我是怎么拼提示词的」「工具怎么注册的」「钱怎么记的」，翻这里。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "read"], description: "list 看清单 / read 读一段" },
        path: { type: "string", description: "action=read 时填：文件路径，例如 src/bot/service.ts" },
        from: { type: "integer", description: "从第几行开始（1 起，默认 1）" },
        lines: { type: "integer", description: "读多少行（默认 80，最多 300）" },
      },
      required: ["action"],
    },
    handler: async (args) => {
      const action = String(args.action ?? "list");

      if (action === "list") {
        const out: string[] = ["能读的源码和文档（只读）："];
        for (const rel of READABLE) {
          try {
            const abs = resolve(rel);
            if (!existsSync(abs)) {
              out.push(`- ${rel}｜（不存在）`);
              continue;
            }
            const n = readFileSync(abs, "utf8").split("\n").length;
            out.push(`- ${rel}｜${n} 行`);
          } catch {
            out.push(`- ${rel}｜（读不到）`);
          }
        }
        out.push("", "读法：action=read + path + from（第几行起）+ lines（读多少行，最多 300）。");
        return { ok: true, text: out.join("\n") };
      }

      if (action === "read") {
        const rel = String(args.path ?? "").replace(/\\/g, "/").replace(/^\.?\//, "");
        if (!READABLE.includes(rel)) {
          return { ok: false, text: `不在可读清单里：${rel}（先用 action=list 看有哪些）` };
        }
        // 双重保险：解析后的真实路径必须落在仓库内
        const abs = resolve(rel);
        const root = resolve(".");
        if (!abs.startsWith(root)) return { ok: false, text: "路径越界了" };
        if (!existsSync(abs)) return { ok: false, text: `没有这个文件：${rel}` };

        const all = readFileSync(abs, "utf8").split("\n");
        const from = Math.max(1, Math.floor(Number(args.from ?? 1)) || 1);
        const want = Math.min(MAX_LINES, Math.max(1, Math.floor(Number(args.lines ?? 80)) || 80));
        const slice = all.slice(from - 1, from - 1 + want);
        if (slice.length === 0) return { ok: true, text: `（${rel} 只有 ${all.length} 行，从第 ${from} 行起是空的）` };

        const numbered = slice.map((l, i) => `${from + i}\t${l}`).join("\n");
        const text = numbered.length > MAX_CHARS ? `${numbered.slice(0, MAX_CHARS)}\n…（超长截断，缩小 lines 再读）` : numbered;
        return {
          ok: true,
          text: [
            `# ${rel}　第 ${from}–${from + slice.length - 1} 行 / 共 ${all.length} 行`,
            text,
          ].join("\n"),
        };
      }

      return { ok: false, text: `不认识的 action：${action}（只有 list / read）` };
    },
  };
  registry.register(tool);
}
