import { openDb } from "../src/db.ts";
import { describeEvent } from "../src/recall.ts";

const db = openDb("data/memory.db");

console.log("=== 一条记忆：存的和看到的 ===");
const e = db
  .prepare("SELECT id, title, detail, core_fragment, cause, effect, tier, source_turn_id FROM events WHERE archived = 0 ORDER BY ts DESC LIMIT 1")
  .get() as Record<string, unknown>;
console.log(`title      : ${String(e.title).slice(0, 80)}`);
console.log(`detail 长度: ${String(e.detail).length} 字`);
console.log(`detail     : ${String(e.detail).slice(0, 160)}`);
console.log(`core       : ${String(e.core_fragment ?? "").slice(0, 80)}`);
console.log(`cause      : ${String(e.cause ?? "无").slice(0, 60)}`);
console.log(`effect     : ${String(e.effect ?? "无").slice(0, 60)}`);
console.log(`tier       : ${String(e.tier)}`);

const row = db.prepare("SELECT * FROM events WHERE id = ?").get(e.id) as Record<string, unknown>;
console.log(`\ndescribeEvent 渲染出来：`);
console.log(`  ${describeEvent(row as never).slice(0, 200)}`);

console.log("\n=== 原始对话还在不在 ===");
const turns = Number(db.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0);
const chars = Number(db.prepare("SELECT COALESCE(SUM(length(text)),0) AS c FROM turns").get()?.c ?? 0);
console.log(`原始对话 ${turns} 轮，共 ${chars} 字（一个字都没删）`);

console.log("\n=== 但模型每轮能看到多少 ===");
const evCount = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
const evChars = Number(db.prepare("SELECT COALESCE(SUM(length(detail)),0) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
console.log(`提取出的记忆 ${evCount} 条，共 ${evChars} 字`);
console.log(`（原始 ${chars} 字 → 提取后 ${evChars} 字，压缩率 ${(evChars / Math.max(1, chars) * 100).toFixed(0)}%）`);

db.close();
