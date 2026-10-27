import { readFileSync, writeFileSync } from "node:fs";

const p = "src/tools/selfmemory.ts";
let s = readFileSync(p, "utf8");

if (!s.includes("memory_day")) {
  const anchor = "  registry.register(recent);";
  const block = [
    "  registry.register(recent);",
    "",
    "  // ── 按天翻：那天到底聊了什么 ──",
    "  const byDay: ToolDefinition = {",
    '    name: "memory_day",',
    '    description:',
    '      "按日期看那一天聊了什么（原始对话，不是摘要）。参数 day 传 2026-10-25 这种格式，不传就是今天。想不起某天的事就用它。",',
    "    parameters: {",
    '      type: "object",',
    "      properties: {",
    '        day: { type: "string", description: "哪一天，格式 2026-10-25；不传则今天" },',
    "      },",
    "    },",
    "    handler: async (args) => {",
    '      const day = String(args.day ?? "").trim() || new Date().toISOString().slice(0, 10);',
    "      const rows = db",
    '        .prepare("SELECT role, text, speaker_id FROM turns WHERE day = ? ORDER BY seq ASC")',
    "        .all(day) as Array<{ role: string; text: string; speaker_id: string }>;",
    "",
    "      if (rows.length === 0) {",
    '        const days = db.prepare("SELECT DISTINCT day FROM turns ORDER BY day DESC LIMIT 8").all() as Array<{ day: string }>;',
    '        return { ok: true, text: `${day} 没有对话。有记录的日子：${days.map((d) => d.day).join("、") || "（空）"}` };',
    "      }",
    "",
    "      let names = new Map<string, string>();",
    "      try {",
    '        const ps = db.prepare("SELECT qq_id, display_name FROM people").all() as Array<{',
    "          qq_id: string;",
    "          display_name: string;",
    "        }>;",
    "        names = new Map(ps.map((x) => [x.qq_id, x.display_name || x.qq_id]));",
    "      } catch {",
    "        // 没有 people 表",
    "      }",
    "",
    "      // 太长就截断，别把上下文塞炸",
    "      const MAX = 60;",
    "      const shown = rows.slice(-MAX);",
    '      const head = shown.length < rows.length ? `（共 ${rows.length} 轮，只显示最后 ${shown.length} 轮）` : `（共 ${rows.length} 轮）`;',
    "",
    "      const lines = shown.map((r) => {",
    '        const who = r.role === "user" ? names.get(String(r.speaker_id ?? "")) ?? r.speaker_id ?? "他" : "凝";',
    "        return `${who}：${String(r.text).slice(0, 100).replace(/\\n/g, \" \")}`;",
    "      });",
    "",
    "      return { ok: true, text: [`${day} ${head}`, ...lines].join(\"\\n\") };",
    "    },",
    "  };",
    "  registry.register(byDay);",
  ].join("\n");

  s = s.replace(anchor, block);
  writeFileSync(p, s, "utf8");
  console.log("memory_day 已加");
}
