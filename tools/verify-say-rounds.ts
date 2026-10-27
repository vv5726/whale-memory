// 验收 a+b+c+d：轮次、say_to、发到：解析、群里她说的话进抽取
import { existsSync, copyFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { loadTuning } from "../src/tuning.ts";
import { ingestTurns } from "../src/extract.ts";
import { dayKey } from "../src/util.ts";

for (const f of ["data/tmp-x.db", "data/tmp-x.db-wal", "data/tmp-x.db-shm"]) if (existsSync(f)) rmSync(f);
copyFileSync("data/memory.db", "data/tmp-x.db");
const cfg = loadBotConfig();

console.log("① 轮次：", JSON.stringify({ replyRounds: loadTuning("data").replyRounds, actRounds: loadTuning("data").actRounds }));

const svc = new BotService(
  { ...cfg, memoryDb: "data/tmp-x.db" },
  {
    deliverText: async (text, to) => ({ ok: true, text: `（桩）发到 ${to || "最近会话"}：${text}` }),
  },
);

const reg = svc.toolRegistry();
console.log("② 工具数：", reg.schema().length, "| 有 say_to：", reg.schema().some((t) => t.function.name === "say_to"));
const r1 = await reg.call("say_to", { text: "我到群里说一句", target: "20001" });
console.log("   say_to(群) →", r1.ok, "|", r1.text);
const r2 = await reg.call("say_to", { text: "只发一句话" });
console.log("   say_to(无 target) →", r2.ok, "|", r2.text);
const r3 = await reg.call("say_to", { text: "   " });
console.log("   say_to(空) →", r3.ok, "|", r3.text);

// ③ speakUp 提示词里有没有「发到：」规则
let prompt = "";
svc.act = async (text) => {
  prompt = text;
  return "沉默";
};
await svc.speakUp({ idleMinutes: 40, used: 1, limit: 3 });
console.log("③ speakUp 提示词含「发到：」规则：", prompt.includes("发到：群号或名字"));
console.log("   那一行：", prompt.split("\n").find((l) => l.includes("发到：")) ?? "(没有)");

// ④ 群里她说的话会不会进抽取
const db = new DatabaseSync("data/tmp-x.db");
ingestTurns(db, [
  { day: dayKey(Date.now()), role: "user", text: "群里别人说的一句", speakerId: "10002", sessionId: "g:20001:10002" },
  { day: dayKey(Date.now()), role: "assistant", text: "她在群里回的一句", speakerId: String(cfg.selfId), sessionId: `g:20001:${cfg.selfId}` },
  { day: dayKey(Date.now()), role: "assistant", text: "她在私聊里回的一句", speakerId: String(cfg.selfId), sessionId: "10001" },
]);
const pending = db
  .prepare("SELECT role, text, session_id FROM turns WHERE processed = 0 ORDER BY seq ASC")
  .all() as Array<{ role: string; text: string; session_id: string }>;
const picked = pending.filter(
  (t) => t.role === "user" || (t.role === "assistant" && t.session_id.startsWith("g:")),
);
console.log("④ 待抽取里会被选中的：");
for (const t of picked) console.log(`   ${t.role.padEnd(9)} ${t.session_id.padEnd(24)} ${t.text}`);
const dropped = pending.filter((t) => !picked.includes(t));
console.log("   被排除的：", dropped.map((t) => `${t.role}/${t.session_id}`).join(", ") || "（无）");
db.close();
svc.close();
for (const f of ["data/tmp-x.db", "data/tmp-x.db-wal", "data/tmp-x.db-shm"]) if (existsSync(f)) rmSync(f);
