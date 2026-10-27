import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-mind-${ts}`);
mkdirSync(dir, { recursive: true });
for (const f of ["src/bot/service.ts", "src/bot/persona.ts", "data/memory.db"]) {
  try {
    copyFileSync(f, join(dir, f.replace(/[\\/]/g, "_")));
  } catch {
    /* 跳过 */
  }
}
console.log(`① 备份 → ${dir}`);

// ② service：回话前先读心
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (s.includes("readMind")) {
    console.log("② service 已有");
  } else {
    const anchor = "      memory,\n      userName: evt.userName,";
    if (!s.includes(anchor)) {
      console.log("② ⚠ 找不到插入点");
    } else {
      s = s.replace(
        anchor,
        [
          "      memory,",
          "      // 回话之前先读心：他的潜台词、情绪、我听完的反应。",
          "      // 失败就不传，退化成原来的样子。",
          "      mind: await readMind(this.cfg.dataDir, text, this.historyFor(evt.sessionId)).catch(() => null),",
          "      userName: evt.userName,",
        ].join("\n"),
      );
      s = s.replace(
        'import { resolveSaidBy } from "../learn-person.ts";',
        'import { resolveSaidBy } from "../learn-person.ts";\nimport { readMind } from "../read-mind.ts";',
      );
      writeFileSync(p, s, "utf8");
      console.log("② service 已接读心");
    }
  }
}

// ③ persona：渲染那两段
{
  const p = "src/bot/persona.ts";
  let s = readFileSync(p, "utf8");
  if (s.includes("【我听完】")) {
    console.log("③ persona 已有");
  } else {
    // 类型
    s = s.replace(
      "    /** 此刻说话的人叫什么（群聊必须给，不然它不知道谁在说） */",
      [
        "    /** 读心结果：他的潜台词、情绪、我听完的反应 */",
        "    mind?: { surface: string; emotion: string; myReaction: string } | null;",
        "    /** 此刻说话的人叫什么（群聊必须给，不然它不知道谁在说） */",
      ].join("\n"),
    );
    // 渲染：放在【怎么说话】之前
    s = s.replace(
      "  parts.push(\"【怎么说话】\");",
      [
        "  if (input.mind && (input.mind.emotion.length > 0 || input.mind.myReaction.length > 0)) {",
        "    parts.push(",
        '      "【他这句话】",',
        "      [",
        '        input.mind.surface ? `表面上：${input.mind.surface}` : "",',
        '        input.mind.emotion ? `情绪：${input.mind.emotion}` : "",',
        "      ]",
        '        .filter(Boolean).join("／"),',
        '      input.mind.myReaction ? `【我听完】${input.mind.myReaction}` : "",',
        '      "——这两行是给你的背景，不是要你说出来的。别复述，别分析自己。",',
        "    );",
        "  }",
        "",
        '  parts.push("【怎么说话】");',
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("③ persona 已加两段");
  }
}
