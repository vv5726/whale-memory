import { readFileSync, writeFileSync } from "node:fs";

const p = "src/bot/service.ts";
let s = readFileSync(p, "utf8");

// 上一步的替换把 `tidy: async () => {` 这行吃掉了，补回来
const target = "          },\n            const stats = await this.sleepNow();";
const fixed = "          },\n          tidy: async () => {\n            const stats = await this.sleepNow();";

if (s.includes(fixed)) {
  console.log("已经有 tidy 了");
} else if (s.includes(target)) {
  s = s.replace(target, fixed);
  writeFileSync(p, s, "utf8");
  console.log("已补回 tidy: async () => {");
} else {
  console.log("没匹配到，需要手工看");
}
