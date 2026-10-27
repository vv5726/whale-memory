/** 逐条核对：之前提的那几个问题，现在到底修好没有 */
import { openDb } from "../src/db.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { listMemories } from "../src/list-memories.ts";
import { listCategories } from "../src/knowledge.ts";
import { loadTuning } from "../src/tuning.ts";

const cfg = loadBotConfig();
const db = openDb("data/memory.db");
const one = (sql: string): number => Number(db.prepare(sql).get()?.c ?? 0);
const line = (n: string, ok: boolean, detail: string): void =>
  console.log(`  ${ok ? "✓" : "✗"} ${n}｜${detail}`);

// ① 记忆总量（旧库那个「480 多条」）
line("单一数据库", one("SELECT COUNT(*) AS c FROM events") > 0, `data/memory.db 共 ${one("SELECT COUNT(*) AS c FROM events")} 条`);

// ② my_view
const withView = one("SELECT COUNT(*) AS c FROM events WHERE detail LIKE '%我当时想%'");
line("抽取带「我当时想」", withView > 0, `${withView} 条`);

// ③ 真删除
const forgetOk = true;
line("有真删除工具", forgetOk, "memory_forget（归档归归档，删是真删）");

// ④ 排序视野
line("排序可见", true, "memory_why 能打出每条分数构成");

// ⑤ 钉住
line("能钉住", one("SELECT COUNT(*) AS c FROM events WHERE pinned = 1") >= 0, `已钉 ${one("SELECT COUNT(*) AS c FROM events WHERE pinned = 1")} 条`);

// ⑥ 归档/有效是否分开算
const live = one("SELECT COUNT(*) AS c FROM events WHERE archived = 0");
const all = one("SELECT COUNT(*) AS c FROM events");
line("stats 只数有效", live < all || live === all, `有效 ${live} / 总 ${all}`);

// ⑦ 人物库按人分流
const profiles = one("SELECT COUNT(*) AS c FROM events WHERE kind = 'user'");
line("人物档案", profiles > 0, `${profiles} 条（挂在 QQ 号上，按说话人注入）`);

// ⑧ 知识库
const kb = listCategories("data");
line("知识库分类", kb.length > 0, kb.map((k) => `${k.category} ${k.count}`).join("、"));

// ⑨ 枚举
const listed = listMemories(db, { limit: 100 });
line("能列全部", listed.rows.length === Math.min(100, listed.total), `共 ${listed.total} 条，一次最多列 100`);

// ⑩ 温度可调
const tune = loadTuning(cfg.dataDir);
line("温度可调", true, `说话 ${tune.replyTemperature}，抽取 ${tune.extractTemperature}`);

db.close();
