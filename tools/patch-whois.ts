import { readFileSync, writeFileSync } from "node:fs";

// ① persona：加「谁是谁」一段
{
  const p = "src/bot/persona.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("input.people")) {
    s = s.replace(
      "    memoryWeak: boolean;",
      [
        "    memoryWeak: boolean;",
        "    /** 已知的人：QQ 号 ↔ 昵称 ↔ 别名 */",
        "    people?: Array<{ qqId: string; name: string; aliases: string[] }>;",
      ].join("\n"),
    );
    s = s.replace(
      '  parts.push(`对方在 QQ 上叫「${input.userName}」。`);',
      [
        '  parts.push(`对方在 QQ 上叫「${input.userName}」。`);',
        "",
        "  if (input.people && input.people.length > 0) {",
        "    const lines = input.people.slice(0, 10).map((p) => {",
        '      const alias = p.aliases.length > 0 ? `（也叫${p.aliases.join("、")}）` : "";',
        '      return p.qqId === String(input.peopleQq ?? "") ? `${p.qqId} = ${p.name}${alias}，就是现在跟你说话的人` : `${p.qqId} = ${p.name}${alias}`;',
        "    });",
        '    parts.push("【谁是谁】记忆里的人用 QQ 号写，对照如下：", ...lines, "你自己叫「凝」。昵称和 QQ 号指同一个人。");',
        "  }",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("persona：谁是谁 已加");
  }
}

// ② service：把人和当前说话人的号传进去
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("listPeople")) {
    s = s.replace(
      'import { ensurePerson, resolvePerson } from "../people.ts";',
      'import { ensurePerson, listPeople, resolvePerson } from "../people.ts";',
    );
    s = s.replace(
      "      memoryWeak: weak,",
      [
        "      memoryWeak: weak,",
        "      people: (() => {",
        "        try {",
        "          return listPeople(this.db);",
        "        } catch {",
        "          return [];",
        "        }",
        "      })(),",
        "      peopleQq: String(evt.userId),",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("service：传入人表");
  }
}
