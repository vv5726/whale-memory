import { readFileSync, writeFileSync } from "node:fs";

// ① memory_stats：只数有效的
{
  const p = "src/tools/selfmemory.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace(
    'const total = count(db, "SELECT COUNT(*) AS c FROM events");',
    'const total = count(db, "SELECT COUNT(*) AS c FROM events WHERE archived = 0");',
  );
  s = s.replace(
    'const tokens = Number(\n        (db.prepare("SELECT COALESCE(SUM(size_tokens),0) AS t FROM events").get() as { t: number } | undefined)?.t ?? 0,\n      );',
    'const tokens = Number(\n        (db.prepare("SELECT COALESCE(SUM(size_tokens),0) AS t FROM events WHERE archived = 0").get() as { t: number } | undefined)?.t ?? 0,\n      );',
  );
  s = s.replace(
    'const tiers = db.prepare("SELECT tier, COUNT(*) AS c, COALESCE(SUM(size_tokens),0) AS t FROM events GROUP BY tier").all()',
    'const tiers = db.prepare("SELECT tier, COUNT(*) AS c, COALESCE(SUM(size_tokens),0) AS t FROM events WHERE archived = 0 GROUP BY tier").all()',
  );
  s = s.replace(
    'const pinned = count(db, "SELECT COUNT(*) AS c FROM events WHERE pinned = 1");',
    'const pinned = count(db, "SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND pinned = 1");',
  );
  writeFileSync(p, s, "utf8");
  console.log("memory_stats：只数有效的了");
}

// ② 自动活动服务：用共享库，别再开分人库
{
  const p = "src/bot.ts";
  let s = readFileSync(p, "utf8");
  const old = 'const autonomyService = new BotService({ ...cfg, memoryDb: join(cfg.dataDir, "users", `${ownerId}.db`) });';
  const neu = '// ⚠️ 这里以前写死成 users/<qq>.db，导致自动活动用的是另一个库\n  // （memory_stats 数的是它，而主对话用的是 data/memory.db）——两边的数永远对不上。\n  const autonomyService = new BotService({\n    ...cfg,\n    memoryDb: cfg.sharedMemory ? join(cfg.dataDir, "memory.db") : join(cfg.dataDir, "users", `${ownerId}.db`),\n  });';
  if (s.includes(old)) {
    s = s.replace(old, neu);
    writeFileSync(p, s, "utf8");
    console.log("bot.ts：自动活动改用共享库");
  } else {
    console.log("bot.ts：锚点没匹配");
  }
}
