import { readFileSync, writeFileSync } from "node:fs";

// ① 读取不再写死 "data"，改成跟随配置
{
  const p = "src/llm/extract.ts";
  let s = readFileSync(p, "utf8");

  s = s.replace(
    '  const herRules = loadExtractRules("data");',
    '  const herRules = loadExtractRules(dataDir);',
  );

  // buildMessages 增加 dataDir 参数（默认 data，兼容老调用）
  s = s.replace(
    "  names: { user: string; assistant: string } = { user: \"他\", assistant: \"凝\" },",
    '  names: { user: string; assistant: string } = { user: "他", assistant: "凝" },\n  /** 数据目录：规则文件从这里读，别再写死 */\n  dataDir = "data",',
  );

  writeFileSync(p, s, "utf8");
  console.log("① 规则读取改为跟随配置");
}

// ② write 默认追加，要覆盖必须传 confirm
{
  const p = "src/tools/extract-rules.ts";
  let s = readFileSync(p, "utf8");

  s = s.replace(
    `    description:
      "改「记忆抽取」的规则。你写的内容会原样追加到抽取提示词末尾，优先级高于默认规则。一次写全（会覆盖上一次的内容），所以先用 extract_rules_read 看一眼再改。\\n\\n适合写什么：一条记忆该带什么、判断怎么写、什么该合并什么该分开。不适合写：输出格式、JSON 结构（那些是代码管的）。",`,
    `    description:
      "改「记忆抽取」的规则。默认是**追加**（不会冲掉原来的）。\\n\\n⚠️ 只有传 confirm: true 才会整套覆盖——那会删掉之前所有规则，慎用。\\n\\n适合写：一条记忆该带什么、判断怎么写、什么该合并什么该分开。不适合写：输出格式、JSON 结构。",
`.replace(/\\n/g, "\n"),
  );

  s = s.replace(
    `        text: { type: "string", description: "完整的新规则内容（会覆盖旧内容）" },
      },
      required: ["text"],`,
    `        text: { type: "string", description: "新规则内容" },
        confirm: { type: "boolean", description: "true = 覆盖掉现有全部规则（危险）；不填 = 追加" },
      },
      required: ["text"],`,
  );

  s = s.replace(
    `      const text = String(args.text ?? "");
      if (text.trim().length < 5) return { ok: false, text: "太短了，写清楚点" };
      saveExtractRules(hooks.dataDir, text);
      return {
        ok: true,
        text: \`规则已更新（\${text.trim().length} 字），下次抽取生效。存在 \${rulesPath(hooks.dataDir)}\`,
      };`,
    `      const text = String(args.text ?? "").trim();
      if (text.length < 5) return { ok: false, text: "太短了，写清楚点" };

      // 覆盖会冲掉之前所有规则——这是踩过的坑，所以必须明说 confirm
      if (args.confirm === true) {
        saveExtractRules(hooks.dataDir, text);
        return { ok: true, text: \`规则已整套覆盖（\${text.length} 字）。下次抽取生效。\` };
      }

      const cur = loadExtractRules(hooks.dataDir);
      if (cur.includes(text)) return { ok: true, text: "这条已经在了，没重复加。" };
      const next = cur.length > 0 ? \`\${cur}\n\${text}\` : text;
      saveExtractRules(hooks.dataDir, next);
      return {
        ok: true,
        text: \`已追加（现在共 \${next.length} 字）。要整套覆盖请传 confirm: true。文件：\${rulesPath(hooks.dataDir)}\`,
      };`,
  );

  writeFileSync(p, s, "utf8");
  console.log("② write 改为默认追加");
}
