import { openDb } from "../src/db.ts";

const db = openDb("data/users/10001.db");
const events = db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c ?? 0;
const watched = db.prepare("SELECT COUNT(*) AS c FROM watched_videos").get()?.c ?? 0;
const pending = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE processed = 0").get()?.c ?? 0;

console.log(`记忆事件：${events} 条`);
console.log(`今天看过：${watched} 个视频`);
console.log(`待整理对话：${pending} 条`);

const hit = db.prepare("SELECT title FROM events WHERE title LIKE '%折叠%' OR detail LIKE '%折叠%'").all();
console.log("\n记忆里有没有折叠屏那条：");
console.log(hit.length > 0 ? hit.map((r) => `  ✓ ${r.title}`).join("\n") : "  ✗ 没有 —— 读过的内容停留在手记文件里，从没进过记忆库");
