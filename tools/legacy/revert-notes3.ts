import { readFileSync, writeFileSync } from "node:fs";

const p = "src/notes.ts";
const lines = readFileSync(p, "utf8").split("\n");

// ① 去掉第一处多出来的 speaker_id 列
const ci = lines.findIndex((l) => l.includes("size_tokens, archived, source_turn_id, created_at, updated_at, speaker_id"));
if (ci >= 0) {
  lines[ci] = lines[ci]!.replace(", speaker_id", "");
  console.log("列已去掉（行 " + (ci + 1) + "）");
}

// ② 去掉我插进去的那行 ""
const pi = lines.findIndex((l) => l.trim() === '""' && lines[lines.indexOf(l) + 1]?.trim() === ");");
if (pi >= 0) {
  lines.splice(pi, 1);
  console.log('参数 "" 已去掉（行 ' + (pi + 1) + "）");
}

// ③ 第一处占位符 28 → 27
const vi = lines.findIndex((l) => l.includes("VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"));
if (vi >= 0) {
  lines[vi] = lines[vi]!.replace("?,?,?)`", "?,?)`");
  console.log("占位符 28 → 27（行 " + (vi + 1) + "）");
}

writeFileSync(p, lines.join("\n"), "utf8");
