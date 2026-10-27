import { readFileSync, writeFileSync } from "node:fs";

const p = "src/extract.ts";
let s = readFileSync(p, "utf8");

// 表里 speaker_id 是 NOT NULL，但这条 INSERT 根本没带这一列
if (!s.includes("updated_at, speaker_id)")) {
  s = s.replace("source_turn_id, created_at, updated_at)", "source_turn_id, created_at, updated_at, speaker_id)");

  // 占位符 27 → 28
  s = s.replace(
    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );

  // 参数末位补 speaker_id（没有就空串，不能是 null）
  s = s.replace("0, 0, sourceTurnId, now, now,", '0, 0, sourceTurnId, now, now, String(e.speakerId ?? ""),');

  writeFileSync(p, s, "utf8");
  console.log("INSERT 已补 speaker_id");
} else {
  console.log("已经有了");
}
