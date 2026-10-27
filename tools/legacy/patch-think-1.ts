import { readFileSync, writeFileSync } from "node:fs";

// ── 1) BotService：随机挑一个锚点，带上和它有关的记忆 ──
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("randomAnchor(")) {
    const marker = "  /** 今天已经主动说了几次 */";
    const block = [
      "  /**",
      "   * 随机挑一个「有记忆掛在上面」的锚点。",
      "   *",
      "   * 这不是检索——检索是「被问什么找什么」，这是「忽然想起谁」。",
      "   * 所以权重不看相关度，只看它有没有实际内容可回忆。",
      "   */",
      "  randomAnchor(): { name: string; kind: string; memories: string[] } | null {",
      "    const rows = this.db",
      '      .prepare(',
      "        `SELECT a.id AS id, a.name AS name, a.kind AS kind, COUNT(ea.event_id) AS c",
      "         FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id",
      "         GROUP BY a.id HAVING c > 0`,",
      "      )",
      "      .all() as Array<{ id: string; name: string; kind: string; c: number }>;",
      "    if (rows.length === 0) return null;",
      "",
      "    const pick = rows[Math.floor(Math.random() * rows.length)]!;",
      "    const evs = this.db",
      "      .prepare(",
      "        `SELECT e.* FROM events e JOIN event_anchors ea ON ea.event_id = e.id",
      "         WHERE ea.anchor_id = ? AND e.archived = 0 ORDER BY e.ts DESC LIMIT 4`,",
      "      )",
      "      .all(pick.id) as Array<Record<string, unknown>>;",
      "",
      "    const memories = evs.map((r) => describeEvent(rowToEvent(r)));",
      "    return { name: pick.name, kind: pick.kind, memories };",
      "  }",
      "",
      "  /**",
      "   * 对着一个锚点自己想事情。",
      "   *",
      "   * 问题和「怎么回答」都是它自己的事——我们只给四个方向：",
      "   * 想知道什么、下一步做什么、有没有该做的、怎么让自己再好一点。",
      "   */",
      "  async think(anchor: { name: string; kind: string; memories: string[] }): Promise<string> {",
      "    return this.act(",
      "      [",
      '        `你忽然想起「${anchor.name}」（${anchor.kind}）。`,",
      '        anchor.memories.length > 0 ? "关于它，你记得：" : "关于它，你其实什么都记不清了。",',
      '        ...anchor.memories.map((m) => `- ${m}`),',
      '        "",',
      '        "现在没人跟你说话。你自己琢磨一下：",",
      '        "1. 关于这件事，我还有什么想知道的？",',
      '        "2. 接下来要干什么？有什么没做完的？",',
      '        "3. 有没有什么事该做但一直没做？",',
      '        "4. 怎么让自己再好一点？",',
      '        "",',
      '        "想查就去查，想做就做（你有工具）。",',
      '        "确实没什么可做的，就只回两个字：算了。",',
      '        "做了或用 self_note 记一笔。",',
      '      ].join("\\n"),',
      "    );",
      "  }",
      "",
      marker,
    ].join("\n");
    s = s.replace(marker, block);

    if (!s.includes("describeEvent")) {
      s = s.replace('import { recall, describeEvent', 'import { recall, describeEvent');
    }
    if (!s.includes("rowToEvent")) {
      s = s.replace('import { openDb, tierTotals }', 'import { openDb, rowToEvent, tierTotals }');
    }
    writeFileSync(p, s, "utf8");
    console.log("service: randomAnchor + think 已加");
  }
}
