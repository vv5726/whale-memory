import { readFileSync, writeFileSync } from "node:fs";

// 1) 清掉按天缓存的旧记录（不然后面还会被挡）
{
  const { openDb } = await import("../src/db.ts");
  const db = openDb("data/memory.db");
  const r = db.prepare("DELETE FROM llm_extractions WHERE sig = '' OR sig IS NULL").run();
  console.log(`清掉旧缓存 ${r.changes} 条`);
  db.close();
}

// 2) 睡眠改成一天一次，凌晨 3-5 点
{
  const p = "data/bot.json";
  const j = JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  j.idleSleepMinutes = 0; // 关掉「聊完就整理」
  j.idleSleepHours = 0; // 关掉「12 小时」
  j.sleepForceThreshold = 0; // 关掉「攒够 50 条就睡」
  j.dailySleepHour = null;
  j.dailySleepWindow = [3, 5]; // 凌晨 3-5 点
  writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`, "utf8");
  console.log("睡眠改为：每天凌晨 3-5 点一次");
}

// 3) config 加窗口字段
{
  const p = "src/bot/config.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("dailySleepWindow")) {
    s = s.replace(
      "  /** 每天固定几点睡一次（0-23），null 表示不定时 */",
      ["  /** 每天在哪个时段整理（[起, 止)，24 小时制）；null 表示不用 */", "  dailySleepWindow: [number, number] | null;", "  /** 每天固定几点睡一次（0-23），null 表示不定时 */"].join("\n"),
    );
    s = s.replace("  dailySleepHour: 4,", "  dailySleepWindow: [3, 5],\n  dailySleepHour: null,");
    writeFileSync(p, s, "utf8");
    console.log("config：dailySleepWindow 已加");
  }
}
