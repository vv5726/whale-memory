import { loadKb } from "../knowledge.ts";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 工具体检：对照「真实工具清单」和「知识库里的工具卡」。
 *
 * 为什么需要：她会自己往知识库里写「工具说明书」（category=工具），
 * 但是凭印象写的——2026-10-26 那次写了 10 张卡、只覆盖 47 个工具里的 28 个，
 * 漏掉的正好是 self_note 这种天天在用的。工具还会改名/加参数，卡不会自动跟。
 * 这个工具让她自己就能对账：哪些没写、哪些卡里的工具已经不存在。
 */
const CARD_CATEGORY = "工具";

export function registerToolAuditTools(registry: ToolRegistry, hooks: { dataDir: string }): void {
  const tool: ToolDefinition = {
    name: "tool_audit",
    description:
      "体检：拿你自己的工具清单，对账知识库里「工具」分类的说明书。告诉你①一共多少工具②哪些还没写卡③卡里提到但已经不存在的工具名。想补全/更新工具知识时先跑它。",
    parameters: {
      type: "object",
      properties: {
        showCovered: { type: "boolean", description: "true = 连已经写过的工具也列出来" },
      },
    },
    handler: async (args) => {
      const all = registry.names().sort();
      const kb = loadKb(hooks.dataDir).entries.filter((e) => e.category === CARD_CATEGORY);
      const text = kb.map((e) => `${e.title} ${e.content}`).join("\n");

      const hasCard = (name: string): boolean => text.includes(name);
      const missing = all.filter((n) => !hasCard(n));
      const covered = all.filter((n) => hasCard(n));

      // 参数名（archived_only / title_like 这种）也带下划线，不能当成「旧工具名」
      const paramNames = new Set<string>();
      for (const s of registry.schema()) {
        const props = (s.function?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
        for (const k of Object.keys(props)) paramNames.add(k);
      }

      // 卡里提到、但工具清单里没有的名字：可能是旧名/改名/笔误
      const mentioned = new Set<string>();
      for (const m of text.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) mentioned.add(m[0]);
      const commonNoise = new Set(["same_day", "co_occur", "msg_id", "qq_id", "self_id", "tool_calls", "tool_choice"]);
      const phantom = [...mentioned]
        .filter((n) => !all.includes(n) && !commonNoise.has(n) && !paramNames.has(n))
        // 她自己写卡时爱用组名前缀（「speech_rules / extract_rules」），
        // 只要真有 speech_rules_read 这类工具，就不算笔误
        .filter((n) => !all.some((tool) => tool.startsWith(`${n}_`)))
        .sort();

      const lines: string[] = [
        `工具清单：${all.length} 个；工具卡：${kb.length} 张（覆盖 ${covered.length} 个，未覆盖 ${missing.length} 个）`,
      ];

      if (missing.length > 0) {
        lines.push("", `【没写卡的 ${missing.length} 个】`);
        for (const n of missing) lines.push(`- ${n}`);
      } else {
        lines.push("", "✓ 每个工具都有卡");
      }

      if (phantom.length > 0) {
        lines.push("", `【卡里有、但工具清单里没有的 ${phantom.length} 个（改过名？笔误？）】`);
        for (const n of phantom.slice(0, 20)) lines.push(`- ${n}`);
      }

      if (args.showCovered === true) {
        lines.push("", `【已经有卡的 ${covered.length} 个】`);
        for (const n of covered) lines.push(`- ${n}`);
      }

      lines.push("", "补卡就用 kb_add，category 填「工具」：写清什么时候用、写什么、注意什么。");
      return { ok: true, text: lines.join("\n") };
    },
  };
  registry.register(tool);
}
