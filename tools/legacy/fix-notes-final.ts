import { readFileSync, writeFileSync } from "node:fs";

const p = "src/notes.ts";
const lines = readFileSync(p, "utf8").split("\n");

// 行号（0 基）：第一处 VALUES 在 55，第二处在 153
const v1 = 55;
const v2 = 153;

// ① 第一处：28 列 → 补一个占位符
if ((lines[v1]!.match(/\?/g) ?? []).length === 27) {
  lines[v1] = lines[v1]!.replace("?,?)`", "?,?,?)`");
  console.log("第一处占位符 27 → 28");
}

// ② 第二处：27 列 → 删一个占位符
if ((lines[v2]!.match(/\?/g) ?? []).length === 28) {
  lines[v2] = lines[v2]!.replace("?,?)`", "?)`");
  console.log("第二处占位符 28 → 27");
}

// ③ 第一处的 run(...) 参数补一个空串（speaker_id）
//    找到 VALUES 之后最近的 "）；"行
let close1 = -1;
for (let i = v1 + 1; i < lines.length; i += 1) {
  if (lines[i]!.trim() === ");") {
    close1 = i;
    break;
  }
}
if (close1 > 0) {
  lines.splice(close1, 0, '      "",');
  console.log(`第一处参数补在行 ${close1 + 1} 前`);
}

writeFileSync(p, lines.join("\n"), "utf8");
