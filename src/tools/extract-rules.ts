import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadExtractRules, rulesPath, saveExtractRules } from "../extract-rules.ts";
import {
  DEFAULT_PROMPT_TEMPLATE,
  PLACEHOLDERS,
  checkPromptTemplate,
  loadPromptTemplate,
  promptPath,
  savePromptTemplate,
} from "../extract-prompt.ts";

/** 运行原理文档：让她能看见抽取是怎么跑的，不只是看提示词 */
function readHow(dataDir: string): string {
  for (const p of [join(dataDir, "..", "docs", "extraction.md"), join("docs", "extraction.md")]) {
    try {
      if (existsSync(p)) return readFileSync(p, "utf8").trim();
    } catch {
      // 换下一个位置
    }
  }
  return "";
}

/**
 * 「记忆抽取」这一整套她自己能看、能改：
 *  - prompt：整套提示词（原版在代码里，她改过就用她那版）
 *  - rules ：她加的零散规矩，接在提示词末尾
 *  - how   ：运行原理（什么时候抽、怎么分批、缓存、解析、写库、去重）
 *
 * 2026-10-27：原来 7 个工具（rules_read/write/add + prompt_read/write/reset + how）合成一个带 action 的。
 * 工具清单每轮都要发一遍，7 份描述的作用只是让人更难挑。
 */
export function registerExtractRulesTools(registry: ToolRegistry, hooks: { dataDir: string }): void {
  const tool: ToolDefinition = {
    name: "extract",
    description:
      "管「记忆抽取」——你每次睡一觉，当天的对话就是按这套东西变成记忆的。\n\naction：\n- prompt_get 看现在生效的整套提示词（含占位符清单）、prompt_set 整套替换、prompt_reset 回代码原版\n- rules_get 看你自己加的零散规矩、rules_add 加一条、rules_set 整套覆盖\n- how 看运行原理（什么时候抽、怎么分批、为什么有时候改了没变化、抽出来怎么解析写库）\n\n改完下次整理记忆生效（缓存会自动失效）。写坏了用 prompt_reset / rules_set 回退。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["prompt_get", "prompt_set", "prompt_reset", "rules_get", "rules_add", "rules_set", "how"],
          description: "prompt_get / prompt_set / prompt_reset / rules_get / rules_add / rules_set / how",
        },
        text: { type: "string", description: "prompt_set 时是完整新提示词；rules_add / rules_set 时是规则正文" },
        confirm: { type: "boolean", description: "rules_set 会覆盖全部旧规则，必须传 confirm: true 才生效" },
      },
      required: ["action"],
    },
    handler: async (args) => {
      const action = String(args.action ?? "prompt_get");

      // ── 提示词 ──
      if (action === "prompt_get") {
        const custom = loadPromptTemplate(hooks.dataDir);
        const text = custom.length > 0 ? custom : DEFAULT_PROMPT_TEMPLATE;
        const from = custom.length > 0 ? `你自己改过的那版（${promptPath(hooks.dataDir)}）` : "代码里的原版";
        return {
          ok: true,
          text: [
            `现在生效的是：${from}`,
            `可用的占位符（打字照抄，别改括号）：${PLACEHOLDERS.join(" ")}`,
            "—— 全文 ——",
            text,
          ].join("\n"),
        };
      }

      if (action === "prompt_set") {
        const text = String(args.text ?? "");
        const problems = checkPromptTemplate(text);
        if (problems.length > 0) {
          return {
            ok: false,
            text: `这段不能生效：\n- ${problems.join("\n- ")}\n\n先用 prompt_get 拿现在生效的全文，在它上面改。`,
          };
        }
        savePromptTemplate(hooks.dataDir, text);
        return {
          ok: true,
          text: `改好了（${text.length} 字）。下次整理记忆就按这版走；不满意可以用 prompt_reset 回原版。`,
        };
      }

      if (action === "prompt_reset") {
        savePromptTemplate(hooks.dataDir, null);
        return { ok: true, text: "已回到原版提示词。" };
      }

      // ── 零散规矩 ──
      if (action === "rules_get") {
        const t = loadExtractRules(hooks.dataDir);
        return { ok: true, text: t.length > 0 ? t : "你还没写过规则。现在抽取按代码里的默认规则走。" };
      }

      if (action === "rules_add") {
        const add = String(args.text ?? "").trim();
        if (add.length < 3) return { ok: false, text: "太短了" };
        const cur = loadExtractRules(hooks.dataDir);
        if (cur.includes(add)) return { ok: true, text: "这条已经在了，没重复加。" };
        const next = cur.length > 0 ? `${cur}\n${add}` : add;
        saveExtractRules(hooks.dataDir, next);
        return { ok: true, text: `加了一条（现在共 ${next.length} 字），下次抽取生效` };
      }

      if (action === "rules_set") {
        const text = String(args.text ?? "").trim();
        if (text.length < 5) return { ok: false, text: "太短了，写清楚点" };
        if (args.confirm !== true) {
          return {
            ok: false,
            text: `rules_set 会冲掉你现在的全部规则（现在 ${loadExtractRules(hooks.dataDir).length} 字）。确定要覆盖就再传一次 confirm: true；只想加一条用 rules_add。`,
          };
        }
        saveExtractRules(hooks.dataDir, text);
        return { ok: true, text: `规则已整套覆盖（${text.length} 字）。下次抽取生效。` };
      }

      // ── 运行原理 ──
      if (action === "how") {
        const doc = readHow(hooks.dataDir);
        if (doc.length === 0) return { ok: false, text: "没找到运行原理文档（docs/extraction.md）。" };
        return { ok: true, text: doc.slice(0, 12000) };
      }

      return {
        ok: false,
        text: `不认识的 action：${action}（只有 prompt_get / prompt_set / prompt_reset / rules_get / rules_add / rules_set / how）`,
      };
    },
  };
  registry.register(tool);
}

/** 兼容旧调用里可能用到的路径常量 */
export { promptPath, rulesPath };
