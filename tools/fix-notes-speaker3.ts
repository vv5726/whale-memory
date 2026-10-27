import { readFileSync, writeFileSync } from "node:fs";

const p = "src/notes.ts";
let s = readFileSync(p, "utf8");
let n = 0;

// 第一处：sourceTurnId, Date.now(), Date.now()
const a = "      sourceTurnId,\n      Date.now(),\n      Date.now(),\n    );";
const a2 = '      sourceTurnId,\n      Date.now(),\n      Date.now(),\n      "",\n    );';
if (s.includes(a)) {
  s = s.replace(a, a2);
  n += 1;
}

// 第二处：null, nowTs, nowTs
const b = "      null,\n      nowTs,\n      nowTs,\n    );";
const b2 = '      null,\n      nowTs,\n      nowTs,\n      "",\n    );';
if (s.includes(b)) {
  s = s.replace(b, b2);
  n += 1;
}

writeFileSync(p, s, "utf8");
console.log(`补了 ${n} 处参数`);
