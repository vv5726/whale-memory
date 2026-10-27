/**
 * 验证走神的闸门：没动作才走神。
 *
 * 线上事故（2026-10-26 16:22）：它回完「哦，表情。」1.6 秒后自己开口催「排序脚本」。
 * 两个原因：
 *  ① busyRecently 看的是本 service 实例的 lastActivityAt，聊天用的却是另一个实例
 *  ② thinkIdleSeconds 只打在启动日志里，从没真的判过
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BotService, activityAgeMs } from "../src/bot/service.ts";
import { AutonomyLoop } from "../src/bot/autonomy.ts";
import { loadBotConfig } from "../src/bot/config.ts";

const tmpDir = "data/tmp-think-gate";
const tmpDb = join(tmpDir, "memory.db");

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

/** 假的模型后端：把喂进来的 messages 记下来，回一句固定的走神输出 */
function makeAdapter(seen: Array<Array<{ role: string; content: string }>>) {
  return {
    complete: async (messages: Array<{ role: string; content: string }>) => {
      seen.push(messages);
      return "目的：想跟他说一句\n途径：聊天\n消息：我刚想起个事";
    },
  };
}

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  copyFileSync("data/memory.db", tmpDb);
  for (const f of ["tuning.json", "thoughts.json", "knowledge.json", "self.md"]) {
    if (existsSync(join("data", f))) copyFileSync(join("data", f), join(tmpDir, f));
  }

  const cfg = {
    ...loadBotConfig(),
    dataDir: tmpDir,
    memoryDb: tmpDb,
    toolsEnabled: false,
    thinkEnabled: true,
    thinkChance: 1,
    thinkIdleSeconds: 30,
    thinkSettleSeconds: 90,
  };

  // 两个实例：一个当聊天用的，一个当走神用的（线上就是这样分的）
  const seenA: Array<Array<{ role: string; content: string }>> = [];
  const seenB: Array<Array<{ role: string; content: string }>> = [];
  const chatSvc = new BotService(cfg, { replyAdapter: makeAdapter(seenA) as never });
  const autoSvc = new BotService(cfg, { replyAdapter: makeAdapter(seenB) as never });

  // ① 聊天实例动了 → 走神实例必须看得见
  console.log("=== ① 跨实例能不能看见「刚有动作」 ===");
  await chatSvc.act("（模拟一次回话）", 1);
  check("聊天实例动过之后，走神实例 busyRecently(90s) 为 true", autoSvc.busyRecently(90_000));
  check("全局时钟记录了这次动作", activityAgeMs() < 90_000, `${Math.round(activityAgeMs() / 1000)} 秒前`);

  // ② 刚说过话 → 不走神
  console.log("\n=== ② 他刚说话时不许走神 ===");
  const loop = new AutonomyLoop(cfg, autoSvc, () => {});
  loop.noteUserMessage(); // bot.ts 每收到一条消息都会调它
  const r1 = await loop.thinkOnce();
  check("结果是没走神", r1.thought === false, `reason=${r1.reason}`);
  check("理由说的是「他刚说过话」", r1.reason.includes("刚说过话"), r1.reason);
  check("这一步没花模型调用", seenB.length === 0, `${seenB.length} 次`);

  // ③ 安静够久（把两个时间闸都放开）→ 真的走神，而且提示词里有刚聊过的对话
  console.log("\n=== ③ 真闲下来时：会走神，且知道刚才在聊什么 ===");
  const cfg2 = { ...cfg, thinkIdleSeconds: 0, thinkSettleSeconds: 0 };
  const seenC: Array<Array<{ role: string; content: string }>> = [];
  const autoSvc2 = new BotService(cfg2, { replyAdapter: makeAdapter(seenC) as never });
  const loop2 = new AutonomyLoop(cfg2, autoSvc2, () => {});
  const r2 = await loop2.thinkOnce();
  check("安静时走了走神", r2.thought === true, `reason=${r2.reason}`);

  const all = seenC.flat().map((m) => m.content).join("\n");
  check("走神提示词里带了【刚才在聊什么】", all.includes("【刚才在聊什么】"));
  check("带了「他：」原话", /他：/.test(all));
  check("带了「我：」原话", /我：/.test(all));
  check("明确说了别催他", all.includes("别催他"));
  check("六问那段还在", all.includes("【静下来时，先想这几个问题】"));

  // ④ 提示词里引用的确实是库里最近的对话（不是瞎编）
  const db = new DatabaseSync(tmpDb, { readOnly: true });
  const lastUser = db
    .prepare("SELECT text FROM turns WHERE role='user' ORDER BY seq DESC LIMIT 1")
    .get() as { text?: string } | undefined;
  db.close();
  const sample = String(lastUser?.text ?? "").replace(/\s+/g, " ").slice(0, 30);
  check("引用的就是库里最后一句他说的", sample.length > 0 && all.includes(sample), sample);

  chatSvc.close();
  autoSvc.close();
  autoSvc2.close();
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
