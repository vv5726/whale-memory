import { readFileSync, writeFileSync } from "node:fs";

const p = "src/tools/selfmemory.ts";
let s = readFileSync(p, "utf8");

if (!s.includes("memory_recent")) {
  const anchor = "  registry.register(tidy);";
  const block = [
    "  registry.register(tidy);",
    "",
    "  // ── 翻最近的原始对话，看看有什么该记而没记的 ──",
    "  const recent: ToolDefinition = {",
    '    name: "memory_recent",',
    '    description:',
    '      "翻最近的原始对话（包括还没整理成记忆的）。用来检查「有没有什么该记却漏了」。看完觉得该记的，用 memory_save 补上。",',
    "    parameters: {",
    '      type: "object",',
    '      properties: {',
    '        n: { type: "integer", description: "看最近几轮，默认 30，最多 80" },',
    "      },",
    "    },",
    "    handler: async (args) => {",
    "      const n = Math.min(80, Math.max(5, Number(args.n) || 30));",
    "      const rows = db",
    '        .prepare("SELECT day, role, text, processed FROM turns ORDER BY seq DESC LIMIT ?")',
    "        .all(n) as Array<{ day: string; role: string; text: string; processed: number }>;",
    "      if (rows.length === 0) return { ok: true, text: \"还没有任何原始对话\" };",
    "",
    "      const lines = rows.reverse().map((r) => {",
    '        const who = r.role === "user" ? "他" : "我";',
    "        const mark = Number(r.processed) === 0 ? \"○\" : \" \";",
    "        return `${mark}${who}：${String(r.text).slice(0, 90)}`;",
    "      });",
    "",
    "      const pending = rows.filter((r) => Number(r.processed) === 0).length;",
    "      return {",
    "        ok: true,",
    "        text: [",
    "          `最近 ${rows.length} 轮（○ = 还没整理成记忆，共 ${pending} 条）：`,",
    "          ...lines,",
    '          "",',
    '          "看完了：有该记而没记的，用 memory_save 补；觉得攒够了，用 memory_tidy 整理。",',
    "        ].join(\"\\n\"),",
    "      };",
    "    },",
    "  };",
    "  registry.register(recent);",
  ].join("\n");

  s = s.replace(anchor, block);
  writeFileSync(p, s, "utf8");
  console.log("memory_recent 已加");
}
