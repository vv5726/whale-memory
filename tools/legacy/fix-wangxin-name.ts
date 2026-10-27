import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../src/db.ts";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-rename-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("data/memory.db", join(dir, "memory.db"));
copyFileSync("src/people.ts", join(dir, "src_people.ts"));
console.log(`① 备份 → ${dir}`);

// ② 数据：把 10002 的主名改回「某人」，🌿 记成别名
const db = openDb("data/memory.db");
const row = db.prepare("SELECT display_name, aliases FROM people WHERE qq_id = ?").get("10002") as
  | { display_name: string; aliases: string }
  | undefined;
if (row) {
  let aliases: string[] = [];
  try {
    aliases = JSON.parse(row.aliases || "[]") as string[];
  } catch {
    aliases = [];
  }
  const set = new Set([...aliases, row.display_name, "🌿"].filter(Boolean));
  set.delete("某人");
  db.prepare("UPDATE people SET display_name = ?, aliases = ? WHERE qq_id = ?").run(
    "某人",
    JSON.stringify([...set]),
    "10002",
  );
  console.log(`② 10002：${row.display_name} → 某人（别名 ${[...set].join("、")}）`);
}

// ③ 代码：以后换群名片只加别名，不再覆盖主名
{
  const p = "src/people.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("不覆盖主名")) {
    const before = s;
    // 找到「昵称变了就更新 display_name」那段
    s = s.replace(
      /if \(nick\.length > 0 && nick !== row\.display_name\)/,
      "if (nick.length > 0 && nick !== row.display_name && row.display_name.trim().length === 0) // 不覆盖主名：群名片会变，名字不该被换掉",
    );
    if (s === before) {
      console.log("③ ⚠ 没匹配到覆盖逻辑，只改了数据");
    } else {
      writeFileSync(p, s, "utf8");
      console.log("③ 已改成「主名不被群名片覆盖」");
    }
  } else console.log("③ 已有");
}
db.close();
