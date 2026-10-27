import { readFileSync, writeFileSync } from "node:fs";

const p = "src/llm/extract-v3.ts";
let s = readFileSync(p, "utf8");

// 挂锚点出问题不该炸掉整批：包一层 try/catch，坏的跳过并记下来
const oldBlock = `    // 锚点：人（people 里的）+ 场景，仅此两类
    for (const p of e.people ?? []) {
      const qq = String(p ?? "").trim();
      if (!/^\\d{5,}$/.test(qq)) continue;
      const a = ensureAnchor(db, qq, "person", Date.now());
      linkEventAnchor(db, row.id, a.id, 1.0);
      newAnchors += 1;
    }
    const scene = sceneAnchorFor(db, turns[0]?.speakerId ? "private" : "group", day);
    if (scene) linkEventAnchor(db, row.id, scene, 0.5);`;

const newBlock = `    // 锚点：人（people 里的）+ 场景，仅此两类。
    // 单个锚点挂不上不该炸掉整批——外面有 20 批要跑。
    try {
      for (const p of e.people ?? []) {
        const qq = String(p ?? "").trim();
        if (!/^\\d{5,}$/.test(qq)) continue;
        const a = ensureAnchor(db, qq, "person", Date.now());
        if (a) {
          linkEventAnchor(db, row.id, a, 1.0);
          newAnchors += 1;
        }
      }
    } catch (err) {
      console.log("  [v3] 挂人锚点失败：" + (err instanceof Error ? err.message : String(err)));
    }
    try {
      const scene = sceneAnchorFor(db, turns[0]?.speakerId ? "private" : "group", day);
      if (scene) linkEventAnchor(db, row.id, scene, 0.5);
    } catch (err) {
      console.log("  [v3] 挂场景锚点失败：" + (err instanceof Error ? err.message : String(err)));
    }`;

if (s.includes(oldBlock)) {
  s = s.replace(oldBlock, newBlock);
  writeFileSync(p, s, "utf8");
  console.log("锚点挂载已包 try/catch");
} else {
  // 兜底：用更宽松的匹配
  const a = s.indexOf("// 锚点：人（people 里的）");
  const b = s.indexOf("}", s.indexOf("if (scene) linkEventAnchor", a));
  if (a > 0 && b > a) {
    const tail = s.indexOf("\n", b);
    s = s.slice(0, a) + newBlock + s.slice(tail);
    writeFileSync(p, s, "utf8");
    console.log("锚点挂载已包 try/catch（宽松匹配）");
  } else {
    console.log("没匹配，请手工看：" + s.split("\n").slice(207, 219).join("\n"));
  }
}
