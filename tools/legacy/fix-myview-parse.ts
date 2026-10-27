import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract.ts";
let s = readFileSync(p, "utf8");

// 之前那次「按行号修模板」把这段解析冲掉了——现在补回来
if (!s.includes("〔我当时想：${view}〕")) {
  const bad = `        detail: str(d.detail, 400),`;
  const good = [
    "        detail: (() => {",
    "          const base = str(d.detail, 400).replace(/主人/g, names.user);",
    '          const rawView = String((d as { my_view?: unknown }).my_view ?? "").trim();',
    '          if (!rawView || rawView === "null" || rawView === "无") return base;',
    "          const view = rawView.replace(/主人/g, names.user).slice(0, 120);",
    "          return `${base}〔我当时想：${view}〕`;",
    "        })(),",
  ].join("\n");
  if (s.includes(bad)) {
    s = s.replace(bad, good);
    writeFileSync(p, s, "utf8");
    console.log("my_view 解析已补回");
  } else {
    console.log("没找到 detail 那一行");
  }
} else {
  console.log("已经有了");
}
