/**
 * 验证：群里 @ 别人时，它认不认得出「@的是谁」。
 *
 * 现场（2026-10-26 17:47）：
 *   [消息] 他: @10002      ← @ 的是某人
 *   [回复] @我干嘛，…            ← 它以为在点它
 * 原因：people（QQ ↔ 名字）只在 say() 调试路径传过，回话主链压根没传。
 *
 * 这个脚本走真的 handle()，把真正发给模型的 messages 截下来看。
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BotService } from "../src/bot/service.ts";
import { loadBotConfig } from "../src/bot/config.ts";

const tmpDir = "data/tmp-at-people";
const tmpDb = join(tmpDir, "memory.db");

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  copyFileSync("data/memory.db", tmpDb);
  for (const f of ["tuning.json", "self.md", "speech-rules.md"]) {
    if (existsSync(join("data", f))) copyFileSync(join("data", f), join(tmpDir, f));
  }

  const cfg = {
    ...loadBotConfig(),
    dataDir: tmpDir,
    memoryDb: tmpDb,
    toolsEnabled: false,
    idleSleepMinutes: 0,
    idleSleepHours: 0,
    dailySleepWindow: null,
  };

  const seen: Array<Array<{ role: string; content: string }>> = [];
  const adapter = {
    complete: async (messages: Array<{ role: string; content: string }>) => {
      seen.push(messages);
      return "某人在群里，我这就去问他";
    },
  };
  const svc = new BotService(cfg, { replyAdapter: adapter as never });

  // 真的走一次 handle：群里 @ 某人（10002），不是 @ 它
  const evt = {
    userId: 10001,
    userName: "他",
    sessionId: "group-20003",
    text: "@10002",
    isGroup: true,
    groupId: 20003,
    mentioned: false,
    selfId: 30001,
  };
  const reply = await svc.handle(evt as never);

  console.log("=== 它这次回了什么 ===");
  console.log(`  ${String(reply).slice(0, 60)}`);
  check("回了话（没炸）", typeof reply === "string" && reply.length > 0);

  const sys = String(seen[0]?.[0]?.content ?? "");
  const block = sys.slice(sys.indexOf("【谁是谁】"));
  console.log("\n=== 提示词里的【谁是谁】 ===");
  console.log(
    block
      .split("\n")
      .slice(0, 12)
      .map((l) => `  ${l}`)
      .join("\n"),
  );

  check("有【谁是谁】这一段", sys.includes("【谁是谁】"));
  check("被 @ 的人认得出：10002 = 某人", sys.includes("10002 = 某人"));
  check("自己的号也在表里：30001 = 你自己", sys.includes("30001 = 你自己"));
  check("当前说话人标了出来：10001 = 他", sys.includes("10001 = 他"));
  check("给了「@号码 = @这个人」的规则", sys.includes("就是 @这个 QQ 号的人"));
  check("并明确「别当成在叫你」", sys.includes("别当成在叫你"));

  const last = seen[0]?.[seen[0].length - 1]?.content ?? "";
  check("原话没被改坏（@ 还在）", last.includes("@10002"), last.slice(0, 40));

  svc.close();
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
