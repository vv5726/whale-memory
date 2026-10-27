import type { DatabaseSync } from "node:sqlite";

/**
 * 场景锚点：群 / 私聊。
 *
 * 权重只有 0.5 —— 现在环境少，每条记忆都会挂一个，给高了就是噪音。
 * 它只是「这条是在哪儿发生的」这个弱标记。
 */
export function sceneAnchorFor(db: DatabaseSync, kind: "group" | "private", idOrDay: string): string | null {
  try {
    const name = kind === "group" ? `群${idOrDay}` : `私聊${idOrDay}`;
    const row = db.prepare("SELECT id FROM anchors WHERE name = ?").get(name) as { id: string } | undefined;
    if (row) return row.id;
    const id = `a_scene_${Math.random().toString(36).slice(2, 10)}`;
    db.prepare(
      "INSERT INTO anchors(id, name, kind, salience, hits, first_seen, last_seen) VALUES(?,?,?,?,?,?,?)",
    ).run(id, name, "scene", 1.0, 1, Date.now(), Date.now());
    return id;
  } catch {
    return null;
  }
}


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
      .replace(/^(他|凝|QQ\d+|\d{5,})[：:\s]*/i, "")
      .replace(/[「」“”"'《》【】()（）[\]]/g, "")
      .replace(/[，。！？；:：、,.;!?]/g, "")
      .trim();
    if (name.length < 4) return null;
    name = name.slice(0, 14);

    const row = db.prepare("SELECT id FROM anchors WHERE name = ?").get(name) as { id: string } | undefined;
    if (row) return row.id;

    const id = `a_ev_${Math.random().toString(36).slice(2, 10)}`;
    db.prepare(
      "INSERT INTO anchors(id, name, kind, salience, hits, first_seen, last_seen) VALUES(?,?,?,?,?,?,?)",
    ).run(id, name, "event", 1.0, 1, Date.now(), Date.now());
    return id;
  } catch {
    return null;
  }
}
