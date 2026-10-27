import { buildMessages } from "../src/llm/extract.ts";

const msgs = buildMessages("2026-10-25", [{ role: "user", text: "x" }], { user: "他", assistant: "凝" }, []);
const sys = String(msgs[0]?.content ?? "");

const literal = sys.split("\n").filter((l) => l.includes("${names.user}"));
console.log(`字面量残留：${literal.length} 行`);
for (const l of literal.slice(0, 5)) console.log(`  ${l.trim().slice(0, 90)}`);

const zhuren = sys.split("\n").filter((l) => l.includes("主人"));
console.log(`还有「主人」：${zhuren.length} 行`);
for (const l of zhuren.slice(0, 3)) console.log(`  ${l.trim().slice(0, 90)}`);
