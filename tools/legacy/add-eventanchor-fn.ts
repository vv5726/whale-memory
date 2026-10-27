import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const p = "src/scene-anchor.ts";
let s = readFileSync(p, "utf8");

if (!s.includes("eventAnchorFor")) {
  s += `

/**
 * 事锚点：从事件标题里长出来。
 *
 * 之前只挂了「人」和「场景」，所以锚点网络里根本没有「事情」这一层——
 * 想到某件事时，找不到那件事本身。
 *
 * 标题规整成 8-14 个字，去掉说话人前缀和标点，同一个名字复用同一个锚点。
 */
export function eventAnchorFor(db: DatabaseSync, title: string): string | null {
  try {
    let name = String(title ?? "")
      .replace(/^(他|凝|QQ\\d+|\\d{5,})[：:\\s]*/i, "")
      .replace(/[「」“”"'《》【】()（）[\\]]/g, "")
      .replace(/[，。！？；:：、,.;!?]/g, "")
      .trim();
    if (name.length < 4) return null;
    name = name.slice(0, 14);

    const row = db.prepare("SELECT id FROM anchors WHERE name = ?").get(name) as { id: string } | undefined;
    if (row) return row.id;

    const id = \`a_ev_\${Math.random().toString(36).slice(2, 10)}\`;
    db.prepare("INSERT INTO anchors(id, name, kind, hits, last_seen) VALUES(?,?,?,?,?)").run(
      id,
      name,
      "event",
      1,
      Date.now(),
    );
    return id;
  } catch {
    return null;
  }
}
`;
  writeFileSync(p, s, "utf8");
  console.log("eventAnchorFor 已加进 scene-anchor.ts");
} else {
  console.log("已存在");
}
