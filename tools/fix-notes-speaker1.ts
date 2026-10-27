import { readFileSync, writeFileSync } from "node:fs";

const p = "src/notes.ts";
let s = readFileSync(p, "utf8");
let changed = 0;

// 两处 INSERT INTO events 都没带 speaker_id，而表里是 NOT NULL
// 做法：在列清单末尾加 speaker_id，值里补一个空串（写笔记时不知道是谁说的）
const colPattern = /INSERT INTO events \(\n([\s\S]{0,600}?)\)\n/g;

s = s.replace(colPattern, (whole, cols: string) => {
  if (cols.includes("speaker_id")) return whole;
  changed += 1;
  return `INSERT INTO events (\n${cols},\n      speaker_id)\n`;
});

writeFileSync(p, s, "utf8");
console.log(`改了 ${changed} 处列清单（接下来要补对应占位符）`);
