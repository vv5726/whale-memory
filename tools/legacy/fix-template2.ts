import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract.ts";
let s = readFileSync(p, "utf8");

// 这一行的引号没包好：需要写成模板字符串里的一段，整行作为一个字符串字面量
const bad = `    "my_view":"我当时怎么想的（没有就 null）",`;
const good = `    '"my_view":"我当时怎么想的（没有就 null）",',`;

if (s.includes(bad)) {
  s = s.replace(bad, good);
  writeFileSync(p, s, "utf8");
  console.log("my_view 行已加引号");
} else {
  console.log("没匹配到");
}
