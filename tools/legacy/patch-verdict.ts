import { readFileSync, writeFileSync } from "node:fs";

const p = "src/db.ts";
let s = readFileSync(p, "utf8");

if (!s.includes('"verdict"')) {
  const anchor = '  ensureColumn(db, "events", "kind", "TEXT NOT NULL DEFAULT \'event\'");';
  s = s.replace(
    anchor,
    [
      anchor,
      "  // 取舍的裁定：keep / demote / superseded / noise，附一句为什么",
      '  ensureColumn(db, "events", "verdict", "TEXT NOT NULL DEFAULT \'\'");',
      '  ensureColumn(db, "events", "verdict_reason", "TEXT NOT NULL DEFAULT \'\'");',
      "  // 从哪一刻起失效（被后来事实推翻的，这里记时间，不删）",
      '  ensureColumn(db, "events", "invalid_at", "INTEGER");',
    ].join("\n"),
  );
  writeFileSync(p, s, "utf8");
  console.log("verdict / invalid_at 已加");
}
