// 验收 feel 工具：看心情 / 改心情（含冷却）/ 列记忆情绪 / 改某条记忆的情绪
import { existsSync, copyFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ToolRegistry } from "../src/tools/registry.ts";
import { registerFeelTools } from "../src/tools/feel.ts";

for (const f of ["data/tmp-feel.db", "data/tmp-feel.db-wal", "data/tmp-feel.db-shm"]) if (existsSync(f)) rmSync(f);
copyFileSync("data/memory.db", "data/tmp-feel.db");

const db = new DatabaseSync("data/tmp-feel.db");
const reg = new ToolRegistry();
registerFeelTools(reg, { db });
const call = async (args: Record<string, unknown>) => {
  const r = await reg.call("feel", args);
  console.log(`\n> feel(${JSON.stringify(args)}) → ok=${r.ok}\n${r.text}`);
  return r;
};

await call({ action: "now" });
await call({ action: "list" });
await call({ action: "set_now", valence: -0.5, arousal: 0.6, note: "今天上午那些事压着" });
await call({ action: "set_now", valence: 0.2, arousal: 0.2 }); // 应该被冷却拦
await call({ action: "now" });

// 找一条记忆改情绪
const row = db.prepare("SELECT id, title, affect_valence, affect_arousal, affect_tags FROM events WHERE archived = 0 ORDER BY ts DESC LIMIT 1").get() as {
  id: string;
  title: string;
  affect_valence: number;
  affect_arousal: number;
  affect_tags: string;
};
console.log(`\n（要改的那条：${row.id} 「${row.title.slice(0, 20)}」 原 v=${row.affect_valence} a=${row.affect_arousal} ${row.affect_tags}）`);
await call({ action: "set_event", id: row.id.slice(0, 12), valence: -0.3, arousal: 0.35, tags: ["无奈"], summary: "苦笑，不是愉快" });

const after = db.prepare("SELECT affect_valence v, affect_arousal a, affect_tags t, affect_summary s, felt_now_at f FROM events WHERE id = ?").get(row.id) as Record<string, unknown>;
console.log("\n库里现在：", JSON.stringify(after));

// 按标题改（不带 id）
await call({ action: "set_event", id: "苦笑", valence: 0, arousal: 0 });
db.close();
for (const f of ["data/tmp-feel.db", "data/tmp-feel.db-wal", "data/tmp-feel.db-shm"]) if (existsSync(f)) rmSync(f);
