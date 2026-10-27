/**
 * ① 合并重复的人锚点（他 / 他（号） / 号码 → 一个）
 * ② 场景锚点不再用「群聊」这种泛名（老数据没有群号，无法拆分，只能停用）
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../src/db.ts";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-mergeperson-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("data/memory.db", join(dir, "memory.db"));
console.log(`① 备份 → ${dir}/memory.db`);

const db = openDb("data/memory.db");
const one = (sql: string): number => Number(db.prepare(sql).get()?.c ?? 0);
console.log(`② 改前：锚点 ${one("SELECT COUNT(*) AS c FROM anchors")}｜挂载 ${one("SELECT COUNT(*) AS c FROM event_anchors")}｜边 ${one("SELECT COUNT(*) AS c FROM edges")}`);

// ─── 合并人锚点 ───
// 从名字里抠出 QQ 号；抠不出就用名字本身
const people = db.prepare("SELECT id, name, kind FROM anchors WHERE kind = 'person'").all() as Array<{
  id: string;
  name: string;
  kind: string;
}>;

const qqOf = (name: string): string | null => {
  const m = /(\d{5,})/.exec(name);
  if (m) return m[1]!;
  // 「他」这种纯名字，去 people 表反查
  const p = db.prepare("SELECT qq_id FROM people WHERE display_name = ?").get(name) as { qq_id: string } | undefined;
  return p?.qq_id ?? null;
};

const groups = new Map<string, typeof people>();
for (const a of people) {
  const key = qqOf(a.name) ?? a.name;
  const list = groups.get(key) ?? [];
  list.push(a);
  groups.set(key, list);
}

let mergedAnchors = 0;
let movedLinks = 0;
const insLink = db.prepare(
  "INSERT INTO event_anchors(event_id, anchor_id, weight) VALUES(?,?,?) ON CONFLICT(event_id, anchor_id) DO UPDATE SET weight = MAX(weight, excluded.weight)",
);
const insAlias = db.prepare(
  "INSERT OR REPLACE INTO anchor_aliases(alias, anchor_id, confidence) VALUES(?,?,?)",
);

for (const [key, list] of groups) {
  if (list.length <= 1) continue;
  // 保留哪个：名字就是号码的 > 名字最短的
  list.sort((a, b) => {
    const aNum = /^\d+$/.test(a.name) ? 0 : 1;
    const bNum = /^\d+$/.test(b.name) ? 0 : 1;
    if (aNum !== bNum) return aNum - bNum;
    return a.name.length - b.name.length;
  });
  const keep = list[0]!;

  for (const dup of list.slice(1)) {
    // 把挂载搬过去
    const links = db.prepare("SELECT event_id, weight FROM event_anchors WHERE anchor_id = ?").all(dup.id) as Array<{
      event_id: string;
      weight: number;
    }>;
    for (const l of links) {
      insLink.run(l.event_id, keep.id, l.weight);
      movedLinks += 1;
    }
    db.prepare("DELETE FROM event_anchors WHERE anchor_id = ?").run(dup.id);
    db.prepare("DELETE FROM edges WHERE src = ? OR dst = ?").run(dup.id, dup.id);
    insAlias.run(dup.name, keep.id, 1.0);
    db.prepare("UPDATE anchors SET kind = 'merged' WHERE id = ?").run(dup.id);
    mergedAnchors += 1;
    console.log(`  合并「${dup.name}」→「${keep.name}」`);
  }
  void key;
}
console.log(`③ 合并了 ${mergedAnchors} 个重复人锚点，搬了 ${movedLinks} 条挂载`);

// ─── 场景：泛名锚点停用 ───
const sceneStopped = db
  .prepare("UPDATE anchors SET kind = 'legacy' WHERE kind = 'scene' AND name IN ('群聊','私聊')")
  .run();
const unlinkScene = db
  .prepare("DELETE FROM event_anchors WHERE anchor_id IN (SELECT id FROM anchors WHERE kind = 'legacy')")
  .run();
console.log(`④ 停用泛名场景锚点：${Number(sceneStopped.changes ?? 0)} 个，摘掉挂载 ${Number(unlinkScene.changes ?? 0)} 条`);

console.log("");
console.log("═══ 改后 ═══");
for (const r of db.prepare("SELECT kind, COUNT(*) AS c FROM anchors GROUP BY kind ORDER BY c DESC").all() as Array<{
  kind: string;
  c: number;
}>) {
  console.log(`  ${r.kind}：${r.c}`);
}
console.log(`  挂载 ${one("SELECT COUNT(*) AS c FROM event_anchors")}｜边 ${one("SELECT COUNT(*) AS c FROM edges")}`);

console.log("");
console.log("  人锚点现在：");
for (const r of db
  .prepare("SELECT a.name, COUNT(*) AS c FROM anchors a JOIN event_anchors ea ON ea.anchor_id = a.id WHERE a.kind = 'person' GROUP BY a.id ORDER BY c DESC LIMIT 6")
  .all() as Array<{ name: string; c: number }>) {
  console.log(`    ${r.name}：${r.c}`);
}
db.close();
