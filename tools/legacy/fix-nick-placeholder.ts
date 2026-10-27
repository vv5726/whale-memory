import { readFileSync, writeFileSync } from "node:fs";

// 1) ensurePerson 忽略「QQ123456」这种占位名
{
  const p = "src/people.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("PLACEHOLDER")) {
    s = s.replace(
      "  const nick = String(displayName ?? \"\").trim();",
      [
        "  // 「QQ123456」这种是占位名，不是真昵称，别拿它覆盖真名",
        "  const rawNick = String(displayName ?? \"\").trim();",
        "  const nick = /^QQ\\d+$/.test(rawNick) ? \"\" : rawNick; // PLACEHOLDER",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("ensurePerson：占位名已忽略");
  }
}

// 2) 修数据：把人表里被覆盖成 QQ 号的改回 他，记忆里的一起换
{
  const { openDb } = await import("../src/db.ts");
  const db = openDb("data/memory.db");

  db.prepare("UPDATE people SET display_name = '他', aliases = ? WHERE qq_id = '10001'").run(
    JSON.stringify(["QQ10001"]),
  );
  db.prepare("DELETE FROM people WHERE qq_id = '10002'");

  const rows = db
    .prepare("SELECT id, title, detail FROM events WHERE title LIKE ? OR detail LIKE ?")
    .all("%QQ10001%", "%QQ10001%") as Array<{ id: string; title: string; detail: string }>;
  for (const r of rows) {
    db.prepare("UPDATE events SET title = ?, detail = ?, updated_at = ? WHERE id = ?").run(
      r.title.split("QQ10001").join("他"),
      r.detail.split("QQ10001").join("他"),
      Date.now(),
      r.id,
    );
  }
  console.log(`记忆里 ${rows.length} 条「QQ10001」→「他」`);

  const people = db.prepare("SELECT qq_id, display_name, aliases FROM people").all() as Array<{
    qq_id: string;
    display_name: string;
    aliases: string;
  }>;
  console.log("\n人表：");
  for (const p of people) console.log(`  ${p.qq_id} → ${p.display_name || "（无名）"}　别名 ${p.aliases}`);
  db.close();
}
