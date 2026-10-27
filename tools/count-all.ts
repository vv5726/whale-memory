import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const live = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
const withView = Number(
  db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND detail LIKE ?").get("%我当时想%")?.c ?? 0,
);

console.log(`有效记忆 ${live} 条，其中带判断 ${withView} 条（${Math.round((withView / Math.max(1, live)) * 100)}%）`);
console.log("");
for (const r of db.prepare("SELECT day, COUNT(*) AS c FROM events WHERE archived = 0 GROUP BY day ORDER BY day").all() as Array<{
  day: string;
  c: number;
}>) {
  const v = Number(
    db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND day = ? AND detail LIKE ?").get(r.day, "%我当时想%")?.c ?? 0,
  );
  console.log(`  ${r.day}：${r.c} 条，带判断 ${v} 条`);
}
db.close();
