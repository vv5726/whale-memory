import { readFileSync, writeFileSync } from "node:fs";

// ── 1) 加「现在的感受」三个字段 ──
{
  const p = "src/db.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("felt_now")) {
    s = s.replace(
      '  ensureColumn(db, "llm_extractions", "sig", "TEXT NOT NULL DEFAULT \'\'");',
      [
        '  ensureColumn(db, "llm_extractions", "sig", "TEXT NOT NULL DEFAULT \'\'");',
        "  // 「当时什么感受」和「现在想起来什么感受」是两回事。",
        "  // 只有前者的话，以后会用后来的平静去冒充当时的难受。",
        '  ensureColumn(db, "events", "felt_now_valence", "REAL");',
        '  ensureColumn(db, "events", "felt_now_arousal", "REAL");',
        '  ensureColumn(db, "events", "felt_now_at", "INTEGER");',
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("db：felt_now_* 三列已加");
  }
}

// ── 2) 渲染时两个都给 ──
{
  const p = "src/recall.ts";
  let s = readFileSync(p, "utf8");
  const old = `    for (const c of factual) {
      const e = c.event;
      const body = describeEvent(e);
      lines.push(\`- （\${periodLabel(e.ts, Date.now())}·\${e.tier}）\${body}\`);
    }`;
  const neu = `    for (const c of factual) {
      const e = c.event;
      const body = describeEvent(e);
      lines.push(\`- （\${periodLabel(e.ts, Date.now())}·\${e.tier}）\${body}\${feelBoth(e, mood)}\`);
    }`;
  if (s.includes(old)) {
    s = s.replace(old, neu);

    // 追加 feelBoth 函数
    s += `

/**
 * 「当时」和「现在」分开说。
 *
 * 一件事当时的感受不会变；但每次想起来，现在的心情会掺进去。
 * 混成一个值，它以后就会用后来的平静冒充当时的难受。
 */
function feelBoth(
  e: { affect: { valence: number; arousal: number }; feltNow?: { valence: number; arousal: number } },
  mood: { valence: number; arousal: number } | null,
): string {
  const atV = Number(e.affect?.valence ?? 0);
  const atA = Number(e.affect?.arousal ?? 0);
  if (Math.abs(atV) < 0.15 && atA < 0.2) return "";

  const word = (v: number, a: number): string =>
    a < 0.3 ? "淡" : v <= -0.4 ? "难受" : v >= 0.4 ? "好受" : "说不上";

  // 现在想起来：原来的强度按现在心境半衰
  const nowV = e.feltNow ? Number(e.feltNow.valence) : atV * (mood ? 0.6 : 0.8) + (mood?.valence ?? 0) * 0.15;
  const nowA = e.feltNow ? Number(e.feltNow.arousal) : atA * (mood ? 0.5 : 0.7);

  return \`〔当时\${word(atV, atA)}，现在想起来\${word(nowV, nowA)}〕\`;
}
`;
    writeFileSync(p, s, "utf8");
    console.log("recall：两个感受分开渲染");
  } else {
    console.log("recall：锚点没匹配");
  }
}
