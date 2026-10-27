import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract.ts";
const lines = readFileSync(p, "utf8").split("\n");

// 找 my_view 那一行，把它和下一行修成合法的模板字面量
const i = lines.findIndex((l) => l.includes("my_view"));
if (i < 0) {
  console.log("没找到 my_view");
  process.exit(1);
}

lines[i] = '    "my_view":"我当时怎么想的（没有就 null）",';
lines[i + 1] = "    '\"promise\":{\"isPromised\":true或false,\"what\":\"约定内容或null\"}}]}',";

writeFileSync(p, lines.join("\n"), "utf8");
console.log("模板行已修:", lines[i].trim(), "|", lines[i + 1].trim().slice(0, 40));
