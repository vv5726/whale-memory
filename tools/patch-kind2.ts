import { readFileSync, writeFileSync } from "node:fs";

// ── ① 新写入的记忆自动分类 ──
{
  const p = "src/notes.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("classify")) {
    s = s.replace(
      'import { analyzeAffect } from "./affect.ts";',
      'import { analyzeAffect } from "./affect.ts";\nimport { classify } from "./classify.ts";',
    );
    // recordOwnNote 与 recordThought 的 INSERT 都加上 kind
    s = s.replace(
      "      affect_valence, affect_arousal, affect_tags, affect_summary,\n      pinned, pin_expires_at, key_facts, strength, mentions, derived_from, context_kinds,",
      "      affect_valence, affect_arousal, affect_tags, affect_summary,\n      pinned, pin_expires_at, key_facts, strength, mentions, derived_from, context_kinds, kind,",
    );
    s = s.replace(
      "    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    // 两个函数各补一个参数（放在 context_kinds 后面）
    s = s.replace(/JSON\.stringify\(\["own-note"\]\),/g, 'JSON.stringify(["own-note"]), classify(`${title} ${clean}`),');
    s = s.replace(/JSON\.stringify\(\["thought"\]\),/g, 'JSON.stringify(["thought"]), classify(`${title} ${clean}`),');
    writeFileSync(p, s, "utf8");
    console.log("notes：新记忆会自动分类");
  }
}

// ── ② 每轮常驻注入：规矩（feedback）+ 你是谁（user） ──
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("alwaysOnMemories")) {
    s = s.replace(
      "  /** 每轮现算的真实数字",
      [
        "  /**",
        "   * 常驻记忆：规矩（feedback）和「你是谁」（user）。",
        "   *",
        "   * 这两类不能靠检索——今天没检索到「他说过要进修」，它就真的不去进修。",
        "   */",
        "  alwaysOnMemories(limit = 8): Array<{ kind: string; text: string }> {",
        "    try {",
        "      const rows = this.db",
        '        .prepare("SELECT kind, title, detail FROM events WHERE archived = 0 AND kind IN (\'feedback\',\'user\') ORDER BY ts DESC LIMIT ?")',
        "        .all(limit) as Array<{ kind: string; title: string; detail: string }>;",
        "      return rows.map((r) => ({ kind: r.kind, text: String(r.title || r.detail).slice(0, 90) }));",
        "    } catch {",
        "      return [];",
        "    }",
        "  }",
        "",
        "  /** 每轮现算的真实数字",
      ].join("\n"),
    );
    s = s.replace("      stats: this.liveStats(),", "      stats: this.liveStats(),\n      alwaysOn: this.alwaysOnMemories(),");
    writeFileSync(p, s, "utf8");
    console.log("service：常驻记忆已接");
  }
}
