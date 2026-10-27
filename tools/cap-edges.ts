import { readFileSync, writeFileSync } from "node:fs";

const p = "tools/rebuild-edges-typed.ts";
let s = readFileSync(p, "utf8");
const before = s;

// ① same-person 只在「至少一起出现 3 次」时才连
s = s.replace(
  'for (const [aid, kind] of kindOf) {\n  if (kind !== "person") continue;\n  const evs = eventsOfAnchor.get(aid) ?? [];',
  'for (const [aid, kind] of kindOf) {\n  if (kind !== "person") continue;\n  const evs = eventsOfAnchor.get(aid) ?? [];\n  if (evs.length < 3) continue; // 偶尔一起出现过不算关系',
);

// ② 每个锚点只留权重最高的 20 条边（别让一个中心点连满全图）
s = s.replace(
  'db.prepare("DELETE FROM edges").run();',
  [
    "// 每个锚点的度上限：只留权重最高的 20 条",
    "const DEGREE_CAP = 20;",
    "const ranked = [...evidence.entries()].map(([key, types]) => {",
    "  const [a, b] = key.split(\"\\u0000\") as [string, string];",
    "  let best = \"co-occur\";",
    "  let bestScore = -1;",
    "  let total = 0;",
    "  for (const [t, c] of types) {",
    "    total += c;",
    "    const score = (PRIORITY[t] ?? 0) * 1000 + c;",
    "    if (score > bestScore) { bestScore = score; best = t; }",
    "  }",
    "  return { a, b, best, total };",
    "});",
    "const degree = new Map<string, number>();",
    "ranked.sort((x, y) => y.total - x.total);",
    "const keptPairs = ranked.filter((e) => {",
    "  const da = degree.get(e.a) ?? 0;",
    "  const db2 = degree.get(e.b) ?? 0;",
    "  if (da >= DEGREE_CAP || db2 >= DEGREE_CAP) return false;",
    "  degree.set(e.a, da + 1);",
    "  degree.set(e.b, db2 + 1);",
    "  return true;",
    "});",
    "",
    'db.prepare("DELETE FROM edges").run();',
  ].join("\n"),
);

// ③ 写库改成用 keptPairs
s = s.replace(
  "const counts = new Map<string, number>();\nconst now = Date.now();\nfor (const [key, types] of evidence) {\n  const [a, b] = key.split(\"\\u0000\") as [string, string];\n  let best = \"co-occur\";\n  let bestScore = -1;\n  let total = 0;\n  for (const [t, c] of types) {\n    total += c;\n    const score = (PRIORITY[t] ?? 0) * 1000 + c;\n    if (score > bestScore) {\n      bestScore = score;\n      best = t;\n    }\n  }\n  const weight = Math.min(3, 1 + Math.log2(1 + total));\n  ins.run(a, b, best, Number(weight.toFixed(2)), now);\n  counts.set(best, (counts.get(best) ?? 0) + 1);\n}",
  "const counts = new Map<string, number>();\nconst now = Date.now();\nfor (const e of keptPairs) {\n  const weight = Math.min(3, 1 + Math.log2(1 + e.total));\n  ins.run(e.a, e.b, e.best, Number(weight.toFixed(2)), now);\n  counts.set(e.best, (counts.get(e.best) ?? 0) + 1);\n}",
);

s = s.replace('console.log(`  边总数 ${evidence.size}`);', 'console.log(`  边总数 ${keptPairs.length}（原始候选 ${evidence.size}，度上限 ${DEGREE_CAP}）`);');

if (s === before) console.log("没有改动");
else {
  writeFileSync(p, s, "utf8");
  console.log("已加两道闸：same-person 需 ≥3 次；每锚点最多 20 条边");
}
