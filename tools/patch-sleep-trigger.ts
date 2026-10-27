import { readFileSync, writeFileSync } from "node:fs";

// ── 1) config：强制睡阈值 ──
{
  const p = "src/bot/config.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("sleepForceThreshold")) {
    s = s.replace(
      "  /** 说话停下几分钟后就整理一次记忆（分钟）。这是主要的触发方式，0 表示关 */",
      [
        "  /** 待整理对话攒到多少条就强制睡一觉（不管在不在聊） */",
        "  sleepForceThreshold: number;",
        "  /** 睡觉前要不要跟人说一声「困了」 */",
        "  announceSleep: boolean;",
        "  /** 说话停下几分钟后就整理一次记忆（分钟）。这是主要的触发方式，0 表示关 */",
      ].join("\n"),
    );
    s = s.replace("  idleSleepMinutes: 3,", "  sleepForceThreshold: 50,\n  announceSleep: true,\n  idleSleepMinutes: 3,");
    writeFileSync(p, s, "utf8");
    console.log("config：sleepForceThreshold / announceSleep 已加");
  }
}

// ── 2) service：攒够了就睡，睡之前说一声 ──
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");

  const oldGate = [
    "    const dailyHit =",
    "      this.cfg.dailySleepHour !== null && hour === this.cfg.dailySleepHour && this.lastSleepDay !== today;",
    "",
    "    if (!idleShort && !idleHit && !dailyHit) return null;",
  ].join("\n");

  const newGate = [
    "    const dailyHit =",
    "      this.cfg.dailySleepHour !== null && hour === this.cfg.dailySleepHour && this.lastSleepDay !== today;",
    "",
    "    // 攒够了就睡：不管有没有人在聊。",
    "    // 之前只按「没人说话」触发，结果一直聊、一直不睡、锚点之间的关系一根都没连上。",
    "    const pendingNow = pendingTurns(this.db);",
    "    const pendingHit = this.cfg.sleepForceThreshold > 0 && pendingNow >= this.cfg.sleepForceThreshold;",
    "",
    "    if (!idleShort && !idleHit && !dailyHit && !pendingHit) return null;",
    "",
    "    // 有人在旁边就说一声，别让人以为它掉线了",
    "    if (pendingHit && this.cfg.announceSleep && !idleShort) {",
    "      try {",
    "        this.opts.notify?.(`有点困了，我去睡一会儿——白天攒了 ${pendingNow} 条对话，得理一理。醒了再聊。`);",
    "      } catch {",
    "        // 说不说都不影响睡",
    "      }",
    "    }",
  ].join("\n");

  if (s.includes(oldGate)) {
    s = s.replace(oldGate, newGate);
    writeFileSync(p, s, "utf8");
    console.log("service：攒够就睡的触发已加");
  } else {
    console.log("service：闸门锚点没匹配");
  }
}
