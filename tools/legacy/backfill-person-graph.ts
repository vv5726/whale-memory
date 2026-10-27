/**
 * 一次性回填：把 people 表修好（悬空 anchor_id / 号码锚点 vs 名字锚点）+ 写出「谁说的」。
 *
 * 幂等，可以重复跑。跑之前自动做一致性快照。
 *   node tools/backfill-person-graph.ts [--dry]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureSelfPerson, linkPeopleToAnchors, syncSpeakerRoles } from "../src/person-graph.ts";

const dry = process.argv.includes("--dry");
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-person-graph-${stamp}`);

function report(db: DatabaseSync, label: string): void {
  const role = db
    .prepare("SELECT role, COUNT(*) c FROM event_anchors GROUP BY role ORDER BY c DESC")
    .all() as Array<{ role: string; c: number }>;
  const dangling = db
    .prepare("SELECT COUNT(*) c FROM people WHERE anchor_id NOT IN (SELECT id FROM anchors)")
    .get() as { c: number };
  const withExternal = db.prepare("SELECT COUNT(*) c FROM anchors WHERE external_id <> ''").get() as { c: number };
  console.log(`\n[${label}] role 分布：${role.map((r) => `${r.role} ${r.c}`).join(" / ")}`);
  console.log(`[${label}] people 悬空 anchor_id：${dangling.c}；锚点带 external_id：${withExternal.c}`);
}

if (dry) {
  const db = new DatabaseSync("data/memory.db", { readOnly: true });
  report(db, "现在");
  db.close();
  console.log("\n（--dry：只看，不动）");
  process.exit(0);
}

mkdirSync(dir, { recursive: true });
{
  const src = new DatabaseSync("data/memory.db");
  src.exec(`VACUUM INTO '${join(dir, "memory.db").replace(/\\/g, "/")}'`);
  src.close();
}
if (existsSync("src/person-graph.ts")) copyFileSync("src/person-graph.ts", join(dir, "person-graph.ts"));
console.log(`备份 → ${dir}`);

const db = new DatabaseSync("data/memory.db");
report(db, "改之前");
// 她自己也进 people（线上由 BotService 构造时调；回填时从 bot.json 读 selfId）
let selfId = "";
try {
  selfId = String(JSON.parse(readFileSync("data/bot.json", "utf8")).selfId ?? "");
} catch {
  /* 没配置就跳过 */
}
if (selfId) {
  ensureSelfPerson(db, selfId, "凝");
  console.log(`\n她自己（${selfId} = 凝）已进 people`);
}
const linked = linkPeopleToAnchors(db);
console.log(`人的绑定：${linked.people} 人，新建锚点 ${linked.created}，新增别名 ${linked.aliasAdded}，修悬空 ${linked.fixed}`);
const roles = syncSpeakerRoles(db);
console.log(
  `说话人角色：${roles.links} 条（扫了 ${roles.events} 条；代词靠证据倒回 ${roles.recovered}、仍归属不了 ${roles.pronouns}、认不出 ${roles.unresolved}）`,
);
report(db, "改之后");
db.close();
