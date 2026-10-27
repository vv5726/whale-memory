// 验收 session_id：落库带来源、memory_recent 能分开看、群场景只取本群
import { existsSync, copyFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { ingestTurns } from "../src/extract.ts";
import { dayKey } from "../src/util.ts";

for (const f of ["data/tmp-s.db", "data/tmp-s.db-wal", "data/tmp-s.db-shm"]) if (existsSync(f)) rmSync(f);
copyFileSync("data/memory.db", "data/tmp-s.db");
const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/tmp-s.db" });
svc.respond = async () => ({ text: "（打桩）", toolText: "" });

await svc.handle({
  userId: 10001, selfId: cfg.selfId, userName: "他", text: "私聊一句话",
  isGroup: false, mentioned: false, sessionId: "10001",
} as never);

const db = new DatabaseSync("data/tmp-s.db");
// 造一条「群里的」数据，验证过滤
ingestTurns(db, [{ day: dayKey(Date.now()), role: "user", text: "群里的一句话", speakerId: "10002", sessionId: "g:20001:10002" }]);

const last = db.prepare("SELECT role, text, session_id FROM turns ORDER BY seq DESC LIMIT 3").all() as Array<{ role: string; text: string; session_id: string }>;
console.log("=== 最新 3 条 turns 的来源 ===");
for (const r of last) console.log(`  ${r.role.padEnd(9)} session_id=${JSON.stringify(r.session_id)}  ${String(r.text).slice(0, 30)}`);

const q = (sql: string, ...p: unknown[]) => (db.prepare(sql).all(...(p as never[])) as Array<{ c: number }>)[0]?.c ?? 0;
console.log("\n=== memory_recent 的三种 scope 会命中多少条 ===");
console.log("  all    :", q("SELECT COUNT(*) c FROM turns"));
console.log("  group  :", q("SELECT COUNT(*) c FROM turns WHERE session_id LIKE 'g:%'"));
console.log("  private:", q("SELECT COUNT(*) c FROM turns WHERE session_id <> '' AND session_id NOT LIKE 'g:%' AND session_id <> 'autonomy'"));
console.log("  autonomy:", q("SELECT COUNT(*) c FROM turns WHERE session_id = 'autonomy'"));

console.log("\n=== 群场景名单（只算本群，老数据会退回全库）===");
const s = svc as unknown as { sceneOf: (e?: unknown) => string };
console.log(s.sceneOf({ isGroup: true, groupId: 20001 }));

db.close();
svc.close();
for (const f of ["data/tmp-s.db", "data/tmp-s.db-wal", "data/tmp-s.db-shm"]) if (existsSync(f)) rmSync(f);
