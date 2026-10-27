/**
 * 验证「读心最后这一跳」到底通没通。
 *
 * ① 直接调 buildChatPrompt({..., mind})：system 里有没有【他这句话】/【我听完】
 * ② 不传 mind：不该出现那段（不能凭空冒出来）
 * ③ 走真实链路：BotService.promptExtras(evt) → ...spread → buildChatPrompt
 *    （router 把 mind 挂在 evt 上，service 通过 promptExtras 交出去——这里验的就是这一段没断）
 */
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { buildChatPrompt } from "../src/bot/persona.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const mind = {
  surface: "问我是不是在忙",
  emotion: "有点不耐烦，想快点得到答复",
  myReaction: "心里一沉，觉得自己又拖了",
};

const base = {
  memory: { contextBlock: "（记忆：今天上午他让我修 bug）" },
  userName: "他",
  history: [{ role: "user" as const, text: "修好了没" }],
  message: "修好了没",
  memoryWeak: false,
  selfText: "",
};

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

// ① 传了 mind
const sysA = String(buildChatPrompt({ ...base, mind })[0]?.content ?? "");
console.log("=== ① buildChatPrompt({..., mind}) 里那一段 ===");
const i = sysA.indexOf("【他这句话】");
console.log(i >= 0 ? sysA.slice(i, sysA.indexOf("现在跟你说话的是", i)).trimEnd() : "（没有这一段）");
check("含【他这句话】", sysA.includes("【他这句话】"));
check("含「表面上：」", sysA.includes("表面上：问我是不是在忙"));
check("含「情绪：」", sysA.includes("情绪：有点不耐烦，想快点得到答复"));
check("含【我听完】", sysA.includes("【我听完】心里一沉，觉得自己又拖了"));
check(
  "在「现在跟你说话的是」之前",
  i >= 0 && i < sysA.indexOf("现在跟你说话的是"),
  `at=${i} speaker=${sysA.indexOf("现在跟你说话的是")}`,
);

// ② 没传 mind
const sysB = String(buildChatPrompt({ ...base })[0]?.content ?? "");
check("不传 mind 时不出现（不凭空冒出来）", !sysB.includes("【他这句话】") && !sysB.includes("【我听完】"));

// ③ 真实链路：service 这一跳
const tmpDb = "data/tmp-verify-mind.db";
try {
  if (existsSync("data/memory.db")) copyFileSync("data/memory.db", tmpDb);
  const cfg = loadBotConfig();
  const svc = new BotService({ ...cfg, memoryDb: tmpDb, toolsEnabled: false });
  const extras = (
    svc as unknown as { promptExtras: (evt?: Record<string, unknown>) => Record<string, unknown> }
  ).promptExtras({ userId: 999002, isGroup: false, userName: "他", sender: { nickname: "他" }, mind });

  console.log("\n=== ③ promptExtras 交出来的 key ===");
  console.log(Object.keys(extras).join(", "));
  check("promptExtras 真的带出了 mind", extras.mind === mind);

  const sysC = String(buildChatPrompt({ ...base, ...extras } as never)[0]?.content ?? "");
  const j = sysC.indexOf("【他这句话】");
  console.log("\n=== ③ 真实链路拼出来的 system 里那一段 ===");
  console.log(j >= 0 ? sysC.slice(j, sysC.indexOf("现在跟你说话的是", j)).trimEnd() : "（没有这一段）");
  check("真实链路 system 含【他这句话】", sysC.includes("【他这句话】"));
  check("真实链路 system 含【我听完】", sysC.includes("【我听完】心里一沉"));

  // 没 mind 的群聊/自主活动那条路不能崩
  const extras2 = (
    svc as unknown as { promptExtras: (evt?: Record<string, unknown>) => Record<string, unknown> }
  ).promptExtras();
  const sysD = String(buildChatPrompt({ ...base, ...extras2 } as never)[0]?.content ?? "");
  check("evt 没有 mind 时照旧（不崩、不多话）", !sysD.includes("【他这句话】"));

  svc.close();
} finally {
  try {
    rmSync(tmpDb, { force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
