import { readFileSync, writeFileSync } from "node:fs";

const p = "src/notes.ts";
let s = readFileSync(p, "utf8");

// 彻底回到原来的状态：两处 INSERT 都不要 speaker_id，占位符都是 27
s = s.replace(/, speaker_id\]/g, "]");
s = s.replace(/\(\?,{27}\?\)`/g, `(${Array(27).fill("?").join(",")})${"`"}`);

writeFileSync(p, s, "utf8");
console.log("notes.ts 已回到 27 列 / 27 占位符");
