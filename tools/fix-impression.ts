import { readFileSync, writeFileSync } from "node:fs";

// ① person-graph：把锚点上的 impression 放进 about 最前面（精确替换，不用正则）
const pg = "src/person-graph.ts";
let s = readFileSync(pg, "utf8");
const oldReturn = `  return {
    qqId: qq,
    name: String(row?.display_name ?? "").trim() || fallbackName,
    aliases,
    spoke: spokeRows.map((r) => brief(r.title)).filter((s) => s.length > 0),
    about: aboutRows.map((r) => brief(r.title)).filter((s) => s.length > 0),
  };`;
const newReturn = `  // 她对这个人「总结出来的印象」存在锚点上，放在 about 最前面——
  // 事件是「发生过什么」，印象是「我怎么看他」，后者可以随时被改写。
  let impression = "";
  try {
    const imp = db
      .prepare(\`SELECT impression FROM anchors WHERE id IN (\${ph}) AND impression != '' ORDER BY last_seen DESC LIMIT 1\`)
      .get(...anchors) as { impression?: string } | undefined;
    impression = String(imp?.impression ?? "").trim();
  } catch {
    impression = "";
  }

  return {
    qqId: qq,
    name: String(row?.display_name ?? "").trim() || fallbackName,
    aliases,
    spoke: spokeRows.map((r) => brief(r.title)).filter((s) => s.length > 0),
    about: [
      ...(impression ? [\`我对他的印象：\${impression}\`] : []),
      ...aboutRows.map((r) => brief(r.title)).filter((s) => s.length > 0),
    ],
  };`;
if (!s.includes("我对他的印象")) {
  if (!s.includes(oldReturn)) {
    console.log("✗ 没匹配到 return 块，未改动");
    process.exit(1);
  }
  s = s.replace(oldReturn, newReturn);
  writeFileSync(pg, s, "utf8");
  console.log("✓ person-graph 带上印象");
} else console.log("· person-graph 已有印象");

// ② impression 工具：名字锚点没有 external_id 时，先经 people 表换成 QQ
const ip = "src/tools/impression.ts";
let t = readFileSync(ip, "utf8");
const resolveFn = `function toQq(db: DatabaseSync, who: string): string {
  const num = (who.match(/\\d{5,}/) ?? [])[0];
  if (num) return num;
  try {
    const p = db.prepare("SELECT qq_id FROM people WHERE display_name = ? OR aliases LIKE ? LIMIT 1").get(who, \`%\${who}%\`) as
      | { qq_id?: string }
      | undefined;
    if (p?.qq_id) return String(p.qq_id);
    const a = db.prepare("SELECT external_id FROM anchors WHERE name = ? AND external_id != '' LIMIT 1").get(who) as
      | { external_id?: string }
      | undefined;
    if (a?.external_id) return String(a.external_id);
  } catch {
    /* ignore */
  }
  return who;
}

`;
if (!t.includes("function toQq")) {
  t = t.replace("export function registerImpressionTools", resolveFn + "export function registerImpressionTools");
  t = t.replace('      const who = String(args.person ?? "").trim();\n      const rows = (', '      const who0 = String(args.person ?? "").trim();\n      const who = who0 ? toQq(hooks.db, who0) : "";\n      const rows = (');
  t = t.replace('      const who = String(args.person ?? "").trim();\n      const text =', '      const who0 = String(args.person ?? "").trim();\n      const who = who0 ? toQq(hooks.db, who0) : "";\n      const text =');
  t = t.replace('.all(who, who)', '.all(who, who0 || who)');
  t = t.replace('.run(text, who, who)', '.run(text, who, who0 || who)');
  t = t.replace('.run(text, who, who);', '.run(text, who, who0 || who);');
  writeFileSync(ip, t, "utf8");
  console.log("✓ impression 支持按名字解析");
} else console.log("· impression 已支持");
