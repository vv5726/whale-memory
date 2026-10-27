/**
 * 真跑一次：造两轮测试对话 → 整理 → 看有没有报错、事件有没有写进去 → 清掉测试数据。
 */
import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");
const marker = `ZZTEST${Date.now().toString(36)}`;
const day = new Date().toISOString().slice(0, 10);
const seqBase = Number(db.prepare("SELECT COALESCE(MAX(seq),0) AS s FROM turns").get()?.s ?? 0) + 1;

const ins = db.prepare(
  "INSERT INTO turns(id, seq, day, ts, role, text, speaker_id, processed, created_at) VALUES(?,?,?,?,?,?,?,0,?)",
);
ins.run(`${marker}a`, seqBase, day, Date.now(), "user", `${marker} 今晚修好了说话人补写空值的问题`, "10001", Date.now());
ins.run(`${marker}b`, seqBase + 1, day, Date.now(), "assistant", "嗯，修好了。", "", Date.now());

const before = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);

const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });
let err = "";
try {
  const r = await svc.sleepNow();
  console.log("整理完成：" + JSON.stringify(r).slice(0, 130));
} catch (e) {
  err = e instanceof Error ? e.message : String(e);
  console.log("整理失败：" + err);
}
svc.close();

const after = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
console.log(`事件 ${before} → ${after}`);

const bad = db.prepare("SELECT COUNT(*) AS c FROM events WHERE speaker_id IS NULL").get() as { c: number };
console.log(`speaker_id 为 NULL 的事件：${bad.c} 条`);

// 清掉测试数据
db.prepare("DELETE FROM events WHERE detail LIKE ? OR title LIKE ?").run(`%${marker}%`, `%${marker}%`);
db.prepare("DELETE FROM turns WHERE id LIKE ?").run(`${marker}%`);
console.log("测试数据已清");

console.log(err ? "结论：仍然失败" : "结论：整理可以跑通");
db.close();
