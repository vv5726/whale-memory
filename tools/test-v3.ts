/** 端到端验证 v3：造两轮对话 → 走真实 sleep → 看三个仓各自写进去没有 */
import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");
console.log(`extractV3 = ${cfg.extractV3}`);

const marker = `V3TEST${Date.now().toString(36)}`;
const day = new Date().toISOString().slice(0, 10);
const seq = Number(db.prepare("SELECT COALESCE(MAX(seq),0) AS s FROM turns").get()?.s ?? 0) + 1;

const ins = db.prepare(
  "INSERT INTO turns(id, seq, day, ts, role, text, speaker_id, processed, created_at) VALUES(?,?,?,?,?,?,?,0,?)",
);
ins.run(`${marker}a`, seq, day, Date.now(), "user", `${marker} 我们说好周六下午三点在南门烧烤聚会，赛百味不吃香菜`, "10001", Date.now());
ins.run(`${marker}b`, seq + 1, day, Date.now(), "assistant", "行，记下了。赛百味不吃香菜这点得避开。", "", Date.now());
ins.run(`${marker}c`, seq + 2, day, Date.now(), "user", `${marker} 「老地方」就是南门烧烤`, "10001", Date.now());

const before = {
  events: Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0),
  kb: Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE context_kinds LIKE '%v3%'").get()?.c ?? 0),
};

const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });
try {
  const r = await svc.sleepNow();
  console.log("整理：" + JSON.stringify(r).slice(0, 120));
} catch (err) {
  console.log("失败：" + (err instanceof Error ? err.message : String(err)));
}
svc.close();

const after = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
console.log(`事件 ${before.events} → ${after}`);

const v3 = db
  .prepare(
    "SELECT title, etype, status, memory_value, evidence, sensitivity FROM events WHERE context_kinds LIKE '%v3%' ORDER BY ts DESC LIMIT 4",
  )
  .all() as Array<{ title: string; etype: string; status: string; memory_value: number; evidence: string; sensitivity: string }>;

console.log("");
console.log(`v3 写进来 ${v3.length} 条：`);
for (const e of v3) {
  console.log(`  【${String(e.title).slice(0, 30)}】${e.etype}/${e.status} 价值${e.memory_value} ${e.sensitivity}`);
  const ev = JSON.parse(e.evidence || "[]") as Array<{ msg_id?: string }>;
  console.log(`    证据 ${ev.map((x) => x.msg_id).join(",") || "无"}`);
}

db.close();
