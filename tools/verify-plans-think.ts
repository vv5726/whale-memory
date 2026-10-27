/**
 * 验证：
 *  ① 计划提醒只在走神里出现（聊天不给）
 *  ② 走神（act 带 plans:true）里出现
 *  ③ 完成的计划写成记忆事件 + 挂锚点，且计划本身不删
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../src/db.ts";
import { addPlan, archivePlanToMemory, listPlans, updatePlan } from "../src/plans.ts";
import { BotService } from "../src/bot/service.ts";
import { loadBotConfig } from "../src/bot/config.ts";

const tmpDir = "data/tmp-plans2";
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const base = loadBotConfig();
  const cfg = {
    ...base,
    dataDir: tmpDir,
    memoryDb: join(tmpDir, "memory.db"),
    deepseekBaseUrl: "http://127.0.0.1:59997",
    deepseekApiKey: "k",
    toolsEnabled: false,
    autonomyEnabled: false,
    proactiveEnabled: false,
    allowPrivate: [10000001],
    allowGroups: [],
  };
  const db = openDb(cfg.memoryDb);
  // 一条已到点的计划
  addPlan(db, { what: "去读字幕", why: "想知道讲了什么", intervalMinutes: 10, anchor: "B站", remindAt: Date.now() - 1000 });

  const captured: Array<{ system: string; user: string }> = [];
  const svc = new BotService(cfg, {
    replyAdapter: {
      name: "cap",
      complete: async (messages: Array<{ role: string; content: string }>) => {
        captured.push({
          system: messages.find((m) => m.role === "system")?.content ?? "",
          user: messages.filter((m) => m.role === "user").map((m) => m.content).join("\n"),
        });
        return "目的：测试\n途径：算了\n消息：";
      },
    } as never,
  });

  console.log("=== ① 聊天里不给计划提醒 ===");
  await svc.handle({ sessionId: "private:10000001", userId: 10000001, userName: "测试", text: "在吗", isGroup: false, selfId: base.selfId });
  const chatSys = captured.at(-1)?.system ?? "";
  check("聊天提示词里没有【计划到点了】", !chatSys.includes("【计划到点了】"));
  check("而且没消耗掉提醒（计划还没算提醒过）", listPlans(db, { status: "active" })[0]?.remindCount === 0);

  console.log("\n=== ② 走神里插进去 ===");
  await svc.think({ name: "B站", kind: "event", memories: ["读过一些视频"], related: [], repeats: 0 }).catch(() => "");
  const thinkAll = captured.map((c) => `${c.system}\n${c.user}`).join("\n");
  check("走神提示词里有【计划到点了】", thinkAll.includes("【计划到点了】"));
  check("带上了计划内容和原因", thinkAll.includes("去读字幕") && thinkAll.includes("想知道讲了什么"));
  check("提醒后已记一次（下次按间隔推后）", (listPlans(db, { status: "active" })[0]?.remindCount ?? 0) >= 1);

  console.log("\n=== ③ 做完 → 记忆 + 锚点，计划保留 ===");
  const plan = listPlans(db, { status: "active" })[0]!;
  const done = updatePlan(db, { id: plan.id, status: "done" });
  check("计划标完成", done.ok === true);
  const mem = archivePlanToMemory(db, done.plan!);
  check("写成记忆事件", mem.ok && !!mem.eventId, mem.text);
  const ev = db.prepare("SELECT title, detail, etype, status FROM events WHERE id = ?").get(mem.eventId!) as
    | { title: string; detail: string; etype: string; status: string }
    | undefined;
  check("事件内容对（标题/类型/状态）", ev?.title === "完成：去读字幕" && ev?.etype === "计划" && ev?.status === "已完成", JSON.stringify(ev)?.slice(0, 80));
  check("事件里写了原因", (ev?.detail ?? "").includes("想知道讲了什么"));
  const link = db.prepare("SELECT anchor_id, role FROM event_anchors WHERE event_id = ?").get(mem.eventId!) as
    | { anchor_id: string; role: string }
    | undefined;
  check("挂到了锚点上", !!link && link.role === "subject", JSON.stringify(link));
  const anchorName = db.prepare("SELECT name FROM anchors WHERE id = ?").get(link?.anchor_id ?? "") as { name: string } | undefined;
  check("挂在正确锚点（B站）", anchorName?.name === "B站", anchorName?.name);
  check("计划本身没被删", listPlans(db, { status: "done" }).length === 1);

  svc.close();
  db.close();
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
