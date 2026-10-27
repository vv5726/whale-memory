import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-saidby-${ts}`);
mkdirSync(dir, { recursive: true });
for (const f of ["src/tools/selfmemory.ts", "src/bot/service.ts"]) {
  copyFileSync(f, join(dir, f.replace(/[\\/]/g, "_")));
}
console.log(`① 备份 → ${dir}`);

// ② 工具：加 saidBy（必填），并校验是真人
{
  const p = "src/tools/selfmemory.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("saidBy")) {
    s = s.replace(
      '      if (!hooks.learn) return { ok: false, text: "现在记不了" };',
      [
        '      if (!hooks.learn) return { ok: false, text: "现在记不了" };',
        "",
        '      const saidBy = String(args.saidBy ?? "").trim();',
        '      if (saidBy.length === 0) {',
        '        return { ok: false, text: "这个说得清是谁说的吗？给我一个具体的人（名字或 QQ 号）。「群友」「某人」不算。" };',
        "      }",
      ].join("\n"),
    );
    s = s.replace("      const ok = hooks.learn(term, meaning);", "      const ok = hooks.learn(term, meaning, saidBy);");
    // 参数表里加 saidBy
    s = s.replace(
      '        meaning: { type: "string", description:',
      '        saidBy: { type: "string", description: "谁说的/谁起的（必须是具体的人：名字或 QQ 号）" },\n        meaning: { type: "string", description:',
    );
    s = s.replace('      required: ["term", "meaning"],', '      required: ["term", "meaning", "saidBy"],');
    writeFileSync(p, s, "utf8");
    console.log("② 工具加了 saidBy");
  } else console.log("② 已有");
}

// ③ service：把 saidBy 解析成人，解析不到就拒绝
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("saidBy")) {
    const line = s.split("\n").find((l) => l.includes("learn: (term, meaning)"))!;
    const replaced = [
      "learn: (term, meaning, saidBy) => {",
      "            // 来源必须是人；群友/某人之类一律拒（否则锚点又成垃圾桶）",
      '            const who = String(saidBy ?? "").trim();',
      "            const person = listPeople(this.db).find(",
      "              (p) => p.qqId === who || p.name === who || (p.aliases ?? []).includes(who),",
      "            );",
      "            if (!person) {",
      '              return false;',
      "            }",
      '            return learnTerm(this.cfg.dataDir, term, meaning, person.name || person.qqId, {',
      "              qq: person.qqId,",
      "              name: person.name || person.qqId,",
      "            });",
      "          },",
    ].join("\n");
    s = s.replace(line.trim() + "\n", replaced + "\n");
    // hook 类型也放开到三个参数
    s = s.replace("learn?: (term: string, meaning: string) => boolean", "learn?: (term: string, meaning: string, saidBy?: string) => boolean");
    writeFileSync(p, s, "utf8");
    console.log("③ service 已解析 saidBy");
  } else console.log("③ 已有");
}
