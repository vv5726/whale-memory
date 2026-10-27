import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-mind2-${ts}`);
mkdirSync(dir, { recursive: true });
for (const f of ["src/bot/service.ts", "src/bot/router.ts", "data/memory.db"]) {
  copyFileSync(f, join(dir, f.replace(/[\\/]/g, "_")));
}
console.log(`① 备份 → ${dir}`);

// ② router：收消息后先读心，挂到 evt 上（不改 service 的调用结构）
{
  const p = "src/bot/router.ts";
  let s = readFileSync(p, "utf8");
  if (s.includes("readMind")) {
    console.log("② router 已有");
  } else {
    const anchor = "    const task = this.chain.then(() => this.serviceFor(evt.userId).handle(evt as never));";
    if (!s.includes(anchor)) {
      console.log("② ⚠ 找不到 router 里的调度行");
    } else {
      s = s.replace(
        anchor,
        [
          "    // 回话之前先读心：他的潜台词、情绪、我听完的反应。",
          "    // 放在 router 这一层，是因为它拿得到原话和历史，又不用改 service 的结构。",
          "    const task = (async () => {",
          "      const svc = this.serviceFor(evt.userId);",
          "      const text = String((evt as { text?: string }).text ?? \"\");",
          "      const mind = await readMind(this.cfg.dataDir, text, svc.historyFor(String((evt as { sessionId?: string }).sessionId ?? \"\")))",
          "        .catch(() => null);",
          "      (evt as { mind?: unknown }).mind = mind;",
          "      return svc.handle(evt as never);",
          "    })();",
        ].join("\n"),
      );
      s = s.replace(
        'import { BotService } from "./service.ts";',
        'import { BotService } from "./service.ts";\nimport { readMind } from "../read-mind.ts";',
      );
      writeFileSync(p, s, "utf8");
      console.log("② router 已接读心");
    }
  }
}

// ③ service：promptExtras 里把 mind 透传出去
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  if (s.includes("mind: (evt as")) {
    console.log("③ service 已有");
  } else {
    // 用我们自己写过的那段「场景」当锚点（中文是干净的）
    const anchor = "      currentSpeakerQq: String(evt?.userId ?? \"\"),";
    if (!s.includes(anchor)) {
      console.log("③ ⚠ 找不到 currentSpeakerQq 那行");
    } else {
      s = s.replace(
        anchor,
        `${anchor}\n      // 读心结果（router 挂上来的），没有就是 null\n      mind: (evt as { mind?: { surface: string; emotion: string; myReaction: string } | null }).mind ?? null,`,
      );
      writeFileSync(p, s, "utf8");
      console.log("③ service 已透传 mind");
    }
  }
}
