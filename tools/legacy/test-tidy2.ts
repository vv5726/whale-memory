import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");
const r = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'events'").get() as { sql: string };
const m = String(r.sql).match(/speaker_id[^,)]*/);
console.log("表定义：" + (m ? m[0] : "没找到"));

const before = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);

const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });
// 制造一点待整理的对话，再跑 tidy
const { recordOwnNote } = await import("../src/notes.ts");
recordOwnNote(db, "测试：抽取写库时 speaker_id 不该为空", Date.now());
db.prepare("UPDATE turns SET processed = 0 WHERE role = 'user'").run();

const out = await svc.sleepNow();
console.log("整理结果：" + JSON.stringify(out).slice(0, 120));

const after = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
console.log(`记忆 ${before} → ${after}`);
svc.close();
db.close();
