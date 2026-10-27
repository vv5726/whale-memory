import { openDb } from "../src/db.ts";

const path = process.argv[2] ?? "data/users/10001.db";
const db = openDb(path);

const ev = Number(db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0);
const an = Number(db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c ?? 0);
const tu = Number(db.prepare("SELECT COUNT(*) AS c FROM turns").get()?.c ?? 0);

console.log(`库：${path}`);
console.log(`事件 ${ev} 条　锚点 ${an} 个　原始对话 ${tu} 条`);

if (ev > 0) {
  console.log("\n--- 事件列表 ---");
  for (const r of db.prepare("SELECT day, tier, title FROM events ORDER BY day").all()) {
    console.log(`  ${r.day} [${r.tier}] ${r.title}`);
  }
}

console.log("\n--- 锚点 ---");
console.log(db.prepare("SELECT name FROM anchors ORDER BY name").all().map((r) => String(r.name)).join("、") || "（无）");

// 演示数据的关键词
const demoWords = ["王建国", "林溪", "团子", "甲状腺", "云南", "火锅", "按摩椅", "打印店", "研究生", "考研"];
const hits: string[] = [];
for (const w of demoWords) {
  const c = Number(db.prepare("SELECT COUNT(*) AS c FROM turns WHERE text LIKE ?").get(`%${w}%`)?.c ?? 0);
  if (c > 0) hits.push(`${w} ×${c}`);
}
console.log("\n--- 演示数据残留检查 ---");
console.log(hits.length === 0 ? "✓ 干净，没有虚构测试数据" : `✗ 发现：${hits.join("、")}`);
