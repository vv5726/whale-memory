import { readFileSync, writeFileSync } from "node:fs";
const p = "src/llm/extract.ts";
let s = readFileSync(p, "utf8");
const dead = '  const sigBase = `${turns.length}:${total}:${head}:${tail}`;\n  return `${EXTRACT_VERSION}:${sigBase}`;\n  return `${turns.length}:${total}:${head}~${tail}`;';
const clean = '  const sigBase = `${turns.length}:${total}:${head}:${tail}`;\n  return `${EXTRACT_VERSION}:${sigBase}`;';
if (s.includes(dead)) { s = s.replace(dead, clean); writeFileSync(p, s, "utf8"); console.log("无用代码已清"); } else { console.log("没匹配到"); }
