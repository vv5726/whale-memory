import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-learnperson-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("src/bot/service.ts", join(dir, "src_bot_service.ts"));
copyFileSync("data/memory.db", join(dir, "memory.db"));
console.log(`① 备份 → ${dir}`);

const p = "src/bot/service.ts";
const lines = readFileSync(p, "utf8").split("\n");

// ② 找 learn hook 那一行，整行替换（只改一行）
const idx = lines.findIndex((l) => l.trim().startsWith("learn: (term, meaning)"));
if (idx < 0) {
  console.log("✗ 找不到 learn hook 那一行");
  process.exit(1);
}
const indent = lines[idx]!.match(/^\s*/)?.[0] ?? "          ";
lines[idx] =
  `${indent}learn: (term, meaning, saidBy) => {` +
  `\n${indent}  const p = resolveSaidBy(this.db, saidBy);` +
  `\n${indent}  return p ? learnTerm(this.cfg.dataDir, term, meaning, p.name, p) : false;` +
  `\n${indent}},`;
console.log("② learn hook 已替换");

// ③ 加 import（放在 lexicon 那行后面）
const lexLine = lines.findIndex((l) => l.includes('from "../lexicon.ts"'));
if (lexLine >= 0 && !lines.some((l) => l.includes("learn-person.ts"))) {
  lines.splice(lexLine + 1, 0, 'import { resolveSaidBy } from "../learn-person.ts";');
  console.log("③ 已加 import");
} else {
  console.log("③ import 已有或找不到 lexicon 行");
}

writeFileSync(p, lines.join("\n"), "utf8");
