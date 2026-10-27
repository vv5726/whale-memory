/**
 * 「她会记得」演示 —— 全部是虚构人物与事件，不含任何真实聊天记录。
 *
 * 跑法：
 *   node demo/recall-demo.ts
 *
 * 它做三件事：
 *   ① 空库先问一遍 → 什么都想不起来（冷启动）
 *   ② 灌 20 条虚构记忆（横跨三周，含一条被推翻的旧决定）
 *   ③ 同样的四个问题再问一遍 → 看她能不能捞到对的那条
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "../src/db.ts";
import { recordOwnNote } from "../src/notes.ts";
import { recall } from "../src/recall.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

const DAY = 86_400_000;
const now = Date.now();
const dir = "data/demo-recall";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(join(dir, "memory.db"));
migrate(db);

const cfg = { ...DEFAULT_CONFIG, dataDir: dir };
const QUESTIONS = [
  "我当初为什么决定不换工作？",
  "那次吵完之后我们是怎么说开的？",
  "我那个「每天读一小时」的计划后来怎么样了？",
  "老周那两千块还清了吗？",
];

function ask(label: string): void {
  console.log(`\n【${label}】`);
  for (const q of QUESTIONS) {
    const r = recall(db, cfg, q, { nowTs: now });
    const top = (r.scored ?? []).slice(0, 3);
    if (top.length === 0) {
      console.log(`  · ${q}\n      → 想不起来`);
      continue;
    }
    console.log(`  · ${q}`);
    for (const t of top) console.log(`      → 〔${t.score?.toFixed(2) ?? "?"} 分〕${String((t as { title?: string }).title ?? "").slice(0, 46)}`);
  }
}

console.log("=== ① 空库（冷启动）===");
ask("这时候她只能说不记得");

// ② 灌虚构记忆（越靠后的越近）
const notes: Array<[number, string]> = [
  [21, "阿臻在公司干了三年，最近连着两周加班到十一点，说想辞职"],
  [21, "阿臻纠结要不要换工作，主要担心新公司不稳定"],
  [20, "阿臻决定不换工作了：房贷还有两年，先熬过这段"],
  [19, "老周问阿臻借了两千块，说下个月发工资还"],
  [18, "阿臻和老周吵了一架，因为老周一直不还钱还装忘"],
  [17, "吵完之后阿臻主动找老周聊，说不是催钱是觉得被忽视"],
  [17, "老周道歉了，说这个月一定还，两人说开了"],
  [15, "阿臻定了「每天读一小时」的计划，想补一下技术"],
  [14, "「每天读一小时」头三天做到了，第四天开始断"],
  [13, "阿臻说读书计划改成一周三次，别把自己逼太紧"],
  [12, "阿臻周末去爬了山，说终于睡了个好觉"],
  [10, "阿臻看了条视频讲怎么跟人道歉，记了个笔记"],
  [9, "阿臻把读书时间挪到早上，说晚上根本读不进去"],
  [7, "老周还了一千，剩一千说下个月"],
  [6, "阿臻说最近状态好多了，加班少了"],
  [5, "阿臻跟家里打电话，被催婚，挂了电话心情不好"],
  [4, "阿臻说自己其实不讨厌这份工作，讨厌的是被当工具用"],
  [3, "阿臻把「每天读一小时」改成了「通勤路上听一听」"],
  [2, "老周把借的两千块都还清了，还请阿臻吃了顿饭"],
  [1, "阿臻说想攒钱，明年想换个大点的房子"],
];
for (const [daysAgo, text] of notes) recordOwnNote(db, text, now - daysAgo * DAY);

// 锚点：真实使用里锚点是抽出来的；演示里手动挂三个，好让「联想」看得见
const ANCHORS: Array<[string, string[]]> = [
  ["换工作", ["换工作", "房贷", "辞职"]],
  ["老周", ["老周"]],
  ["读书计划", ["读一小时", "读书", "通勤路上听"]],
];
for (const [name, keywords] of ANCHORS) {
  const anchorId = "anc_demo_" + name;
  db.prepare("INSERT OR REPLACE INTO anchors (id, name, kind, salience, hits, first_seen, last_seen, external_id) VALUES (?, ?, 'event', 1.0, 1, ?, ?, '')").run(anchorId, name, now - 21 * DAY, now);
  const rows = db.prepare("SELECT id, title FROM events").all() as Array<{ id: string; title: string }>;
  for (const r of rows) {
    if (keywords.some((k) => String(r.title).includes(k))) {
      db.prepare("INSERT OR REPLACE INTO event_anchors (event_id, anchor_id, weight, role) VALUES (?, ?, 1.0, 'subject')").run(r.id, anchorId);
    }
  }
}

console.log("\n=== ② 灌了 20 条虚构记忆（横跨三周）===");
console.log(`  库里现在有 ${db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c} 条事件、${db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c} 个锚点`);

console.log("\n=== ③ 同样的问题再问一遍 ===");
ask("这次能捞到具体的");

console.log("\n注：以上人物、金额、事件全部虚构；演示只证明「检索能不能命中」，不代表真实效果。");
db.close();
rmSync(dir, { recursive: true, force: true });
