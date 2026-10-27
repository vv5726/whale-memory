import { readFileSync, writeFileSync } from "node:fs";

const p = "src/tools/bili.ts";
let s = readFileSync(p, "utf8");

// 回退：插入时不要引用还没声明的 view
s = s.replace(
  '.run(new Date().toISOString().slice(0, 10), bvid, view.data?.title ?? "", Date.now());',
  '.run(new Date().toISOString().slice(0, 10), bvid, "", Date.now());',
);

// 取到 view 之后，再把标题补回那条记录
const anchor = "        const aid = view.data?.aid;\n        const cid = view.data?.pages?.[0]?.cid;";
const patched = [
  "        const aid = view.data?.aid;",
  "        const cid = view.data?.pages?.[0]?.cid;",
  "        // 标题后补：插入额度记录时还没取到 view，这里把标题写回去",
  "        if (opts.db && view.data?.title) {",
  '          opts.db',
  '            .prepare("UPDATE watched_videos SET title = ? WHERE day = ? AND bvid = ?")',
  '            .run(view.data.title, new Date().toISOString().slice(0, 10), bvid);',
  "        }",
].join("\n");

if (s.includes(anchor)) {
  s = s.replace(anchor, patched);
  writeFileSync(p, s, "utf8");
  console.log("已修：标题改到 view 之后补写");
} else {
  console.log("锚点没匹配到");
}
