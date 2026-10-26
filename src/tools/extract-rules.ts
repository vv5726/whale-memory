import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { loadExtractRules, rulesPath, saveExtractRules } from "../extract-rules.ts";

/** 给她改抽取规则的权限：读、写、追加 */
export function registerExtractRulesTools(
  registry: ToolRegistry,
  hooks: { dataDir: string },
): void {
  const read: ToolDefinition = {
    name: "extract_rules_read",
    description: "看你要给「记忆抽取」加的规则（这是你自己写的那部分，代码里的底线规则你看不到也改不了）。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const t = loadExtractRules(hooks.dataDir);
      return {
        ok: true,
        text: t.length > 0 ? t : "你还没写过规则。现在抽取按代码里的默认规则走。",
      };
    },
  };
  registry.register(read);

  const write: ToolDefinition = {
    name: "extract_rules_write",
    description:
      "改「记忆抽取」的规则。默认是**追加**（不会冲掉原来的）。\n\n⚠️ 只有传 confirm: true 才会整套覆盖——那会删掉之前所有规则，慎用。\n\n适合写：一条记忆该带什么、判断怎么写、什么该合并什么该分开。不适合写：输出格式、JSON 结构。",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "新规则内容" },
        confirm: { type: "boolean", description: "true = 覆盖掉现有全部规则（危险）；不填 = 追加" },
      },
      required: ["text"],
    },
    handler: async (args) => {
      const text = String(args.text ?? "").trim();
      if (text.length < 5) return { ok: false, text: "太短了，写清楚点" };

      // 覆盖会冲掉之前所有规则——这是踩过的坑，所以必须明说 confirm
      if (args.confirm === true) {
        saveExtractRules(hooks.dataDir, text);
        return { ok: true, text: `规则已整套覆盖（${text.length} 字）。下次抽取生效。` };
      }

      const cur = loadExtractRules(hooks.dataDir);
      if (cur.includes(text)) return { ok: true, text: "这条已经在了，没重复加。" };
      const next = cur.length > 0 ? `${cur}
${text}` : text;
      saveExtractRules(hooks.dataDir, next);
      return {
        ok: true,
        text: `已追加（现在共 ${next.length} 字）。要整套覆盖请传 confirm: true。文件：${rulesPath(hooks.dataDir)}`,
      };
    },
  };
  registry.register(write);

  const append: ToolDefinition = {
    name: "extract_rules_add",
    description: "在现有规则后面追加一条，不覆盖原来的。",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "要追加的一条" },
      },
      required: ["text"],
    },
    handler: async (args) => {
      const add = String(args.text ?? "").trim();
      if (add.length < 3) return { ok: false, text: "太短了" };
      const cur = loadExtractRules(hooks.dataDir);
      const next = cur.length > 0 ? `${cur}\n${add}` : add;
      saveExtractRules(hooks.dataDir, next);
      return { ok: true, text: `加了一条（现在共 ${next.length} 字），下次抽取生效` };
    },
  };
  registry.register(append);
}
