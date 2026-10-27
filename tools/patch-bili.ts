import { readFileSync, writeFileSync } from "node:fs";

const p = "src/tools/bili.ts";
let s = readFileSync(p, "utf8");

const before = "const view = await api<{ code: number; data?: { aid: number; pages?: Array<{ cid: number }> } }>(";
const after = "const view = await api<{ code: number; data?: { aid: number; title?: string; pages?: Array<{ cid: number }> } }>(";

let n = 0;
if (s.includes(before)) {
  s = s.replace(before, after);
  n += 1;
}

const insBefore = '.run(new Date().toISOString().slice(0, 10), bvid, "", Date.now());';
const insAfter = '.run(new Date().toISOString().slice(0, 10), bvid, view.data?.title ?? "", Date.now());';
if (s.includes(insBefore)) {
  s = s.replace(insBefore, insAfter);
  n += 1;
}

writeFileSync(p, s, "utf8");
console.log(`改了 ${n} 处`);
