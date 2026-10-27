import { readFileSync, writeFileSync } from "node:fs";

// ── ① historyFor：带上说话人 ──
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");

  s = s.replace(
    '        .prepare("SELECT role, text FROM turns ORDER BY seq DESC LIMIT ?")',
    '        .prepare("SELECT role, text, speaker_id FROM turns ORDER BY seq DESC LIMIT ?")',
  );
  s = s.replace(
    '        .all(HISTORY_LIMIT) as Array<{ role: string; text: string }>;',
    '        .all(HISTORY_LIMIT) as Array<{ role: string; text: string; speaker_id: string }>;',
  );
  s = s.replace(
    `      const restored = rows
        .reverse()
        .map((r) => ({
          role: (r.role === "user" ? "user" : "assistant") as "user" | "assistant",
          text: String(r.text ?? ""),
        }))
        .filter((m) => m.text.length > 0);`,
    `      // 说话人名字：群里不止一个人，不标出来就会被当成同一个人连着说
      const nameOf = new Map<string, string>();
      try {
        for (const p of listPeople(this.db)) nameOf.set(p.qqId, p.name || p.qqId);
      } catch {
        // 没有 people 表就算了
      }
      const restored = rows
        .reverse()
        .map((r) => ({
          role: (r.role === "user" ? "user" : "assistant") as "user" | "assistant",
          text: String(r.text ?? ""),
          speaker: r.role === "user" ? nameOf.get(String(r.speaker_id ?? "")) ?? "" : "",
        }))
        .filter((m) => m.text.length > 0);`,
  );

  s = s.replace(
    "  private historyFor(sessionId: string): Array<{ role: \"user\" | \"assistant\"; text: string }> {",
    '  private historyFor(sessionId: string): Array<{ role: "user" | "assistant"; text: string; speaker?: string }> {',
  );
  s = s.replace(
    '  private history = new Map<string, Array<{ role: "user" | "assistant"; text: string }>>();',
    '  private history = new Map<string, Array<{ role: "user" | "assistant"; text: string; speaker?: string }>>();',
  );

  writeFileSync(p, s, "utf8");
  console.log("historyFor：已带说话人");
}

// ── ② persona：拼消息时把名字放到正文前面 ──
{
  const p = "src/bot/persona.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace(
    '  for (const h of input.history.slice(-16)) {\n    messages.push({ role: h.role, content: h.text });\n  }',
    `  // 每条都带名字。群里好几个人说话，不标出来它就会当成同一个人连着说。
  for (const h of input.history.slice(-16)) {
    const label = h.role === "assistant" ? "凝" : h.speaker || input.userName || "对方";
    messages.push({ role: h.role, content: \`\${label}：\${h.text}\` });
  }`,
  );
  s = s.replace(
    "    history: Array<{ role: \"user\" | \"assistant\"; text: string }>;",
    '    history: Array<{ role: "user" | "assistant"; text: string; speaker?: string }>;',
  );
  writeFileSync(p, s, "utf8");
  console.log("persona：历史消息已带名字");
}
