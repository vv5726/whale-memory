import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-learn2-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("src/bot/service.ts", join(dir, "src_bot_service.ts"));
console.log(`① 备份 → ${dir}`);

const p = "src/bot/service.ts";
let s = readFileSync(p, "utf8");

// learn hook 被压在很长的一行里，只能用正则替换那一段
const re = /learn: \(term, meaning\) => learnTerm\([^)]*\)/;
if (re.test(s)) {
  s = s.replace(
    re,
    "learn: (term, meaning, saidBy) => { const person = resolveSaidBy(this.db, saidBy); return person ? learnTerm(this.cfg.dataDir, term, meaning, person.name, person) : false; }",
  );
  console.log("② learn hook 已替换");
} else if (s.includes("resolveSaidBy(this.db")) {
  console.log("② 已有");
} else {
  console.log("✗ 没匹配到 learn hook");
}

// import
if (!s.includes('from "../learn-person.ts"')) {
  s = s.replace(
    'import { attachTermAnchors, learnTerm, matchTerms, termsForAnchors } from "../lexicon.ts";',
    'import { attachTermAnchors, learnTerm, matchTerms, termsForAnchors } from "../lexicon.ts";\nimport { resolveSaidBy } from "../learn-person.ts";',
  );
  if (!s.includes('from "../learn-person.ts"')) {
    // 兜底：插在第一个 import 之后
    s = s.replace(/^(import [^\n]*\n)/, '$1import { resolveSaidBy } from "../learn-person.ts";\n');
  }
  console.log("③ import 已加");
}

writeFileSync(p, s, "utf8");
