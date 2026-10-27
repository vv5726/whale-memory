// 追查：刚才那两条到底写进哪了、情绪是什么
import { existsSync, copyFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../src/db.ts";
import { loadAnchorIndex } from "../src/anchors.ts";
import { extractDayV3 } from "../src/llm/extract-v3.ts";
import { dayKey } from "../src/util.ts";

const tmp = "data/tmp-v3b.db";
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(f)) rmSync(f);
copyFileSync("data/memory.db", tmp);
const db = openDb(tmp);
const index = loadAnchorIndex(db);
const day = dayKey(Date.now());

const turns = [
  { id: "t1", role: "user" as const, text: "那个视频我看了，苦笑不得，叹气", speakerId: "10001" },
  { id: "t2", role: "user" as const, text: "他母单多年，你就这么把兄弟卖了", speakerId: "10002" },
];
const adapter = {
  name: "fake",
  complete: async () =>
    JSON.stringify({
      events: [
        {
          type: "经历",
          title: "他看了个哭笑不得的视频",
          people: ["10001"],
          content: "他说那个视频看完哭笑不得，一直在叹气",
          status: "已发生",
          evidence: [{ speaker: "10001", msg_id: "t1", quote: "哭笑不得" }],
          memory_value: 6,
          affect: { valence: -0.4, arousal: 0.35, tags: ["无奈"], summary: "看完只想叹气" },
        },
        {
          type: "信息",
          title: "他拿阿牙易母单多年开玩笑",
          people: ["10002"],
          content: "他说阿牙易母单多年，等于把兄弟卖了",
          status: "仅记录",
          evidence: [{ speaker: "10002", msg_id: "t2", quote: "母单多年" }],
          memory_value: 5,
        },
      ],
    }),
} as never;

const r = await extractDayV3(db, { contextBudgetTokens: 200000, dataDir: "data" } as never, index, adapter, day, turns, {
  user: "10001",
  assistant: "凝",
});
console.log("抽取结果：", JSON.stringify(r));

const rows = db
  .prepare("SELECT title, ts, affect_valence v, affect_arousal a, affect_tags t, affect_summary s, created_at FROM events WHERE title IN ('他看了个哭笑不得的视频','他拿阿牙易母单多年开玩笑')")
  .all() as Array<{ title: string; ts: number; v: number; a: number; t: string; s: string; created_at: number }>;
console.log(`\n找到 ${rows.length} 条：`);
for (const x of rows) {
  console.log(`  「${x.title}」 v=${x.v} a=${x.a} tags=${x.t} summary=${x.s}`);
}

const anchors = db
  .prepare(
    "SELECT e.title, COUNT(ea.anchor_id) c FROM events e JOIN event_anchors ea ON ea.event_id = e.id WHERE e.title IN ('他看了个哭笑不得的视频','他拿阿牙易母单多年开玩笑') GROUP BY e.id",
  )
  .all() as Array<{ title: string; c: number }>;
console.log("\n每条挂了几类锚点（应 = 人 + 事 + 场景，最多 3，但不是同一个事锚点被挂 3 次）：");
for (const a of anchors) console.log(`  ${a.c} 个  ${a.title}`);
const detail = db
  .prepare(
    "SELECT a.name, a.kind, ea.weight FROM event_anchors ea JOIN anchors a ON a.id = ea.anchor_id JOIN events e ON e.id = ea.event_id WHERE e.title = '他看了个哭笑不得的视频'",
  )
  .all() as Array<{ name: string; kind: string; weight: number }>;
console.log("  「他看了个哭笑不得的视频」挂的是：");
for (const d of detail) console.log(`    ${d.kind}｜${d.name}｜weight ${d.weight}`);

db.close();
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(f)) rmSync(f);
