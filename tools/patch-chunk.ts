import { readFileSync, writeFileSync } from "node:fs";

// ① sleep：一天拆成多段抽取——575 轮塞一次，模型只能挑出几条
{
  const p = "src/sleep.ts";
  let s = readFileSync(p, "utf8");

  const old = `        extracted = await extractDayWithLlm(db, cfg, index, adapter, day, dayTurns, { user: ownerQq ? \`\${ownerName}（\${ownerQq}）\` : ownerName, assistant: "凝" });`;
  const neu = `        // 一次喂一整天（575 轮）模型挑不动，只会给出三五条。
        // 切成 60 轮一段，每段自己划事件的起止，加起来才是完整的一天。
        const CHUNK = 60;
        const names = { user: ownerQq ? \`\${ownerName}（\${ownerQq}）\` : ownerName, assistant: "凝" };
        let merged: typeof extracted | null = null;
        for (let i = 0; i < dayTurns.length; i += CHUNK) {
          const chunk = dayTurns.slice(i, i + CHUNK);
          const part = await extractDayWithLlm(db, cfg, index, adapter, day, chunk, names);
          if (!merged) {
            merged = part;
          } else {
            merged.inserted += part.inserted;
            merged.anchors += part.anchors;
            merged.edges += part.edges;
          }
        }
        extracted = merged!;`;

  if (s.includes(old)) {
    s = s.replace(old, neu);
    writeFileSync(p, s, "utf8");
    console.log("sleep：已改成 60 轮一段");
  } else {
    console.log("sleep：锚点没匹配");
  }
}

// ② 抽取提示词里所有「主人」换成真名变量
{
  const p = "src/llm/extract.ts";
  let s = readFileSync(p, "utf8");
  const before = (s.match(/主人/g) ?? []).length;
  s = s.replace(/\$\{names\.user\}（\$\{names\.user\}）/g, "${names.user}");
  s = s.replace(/主人/g, "${names.user}");
  writeFileSync(p, s, "utf8");
  console.log(`extract：「主人」替换 ${before} 处`);
}
