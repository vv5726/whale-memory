/**
 * 验证计划表：
 *  ① 四项必填（缺 reasons 会被点名拒绝）
 *  ② 建 → 列表 → 改（含改时间）→ 完成 → 删除
 *  ③ 到点提醒：duePlans 拿到、markReminded 推后一个间隔
 *  ④ 跟锚点关联：能复用已有锚点、没有会新建
 *  ⑤ 真进提示词：到点后 promptExtras 把它塞进 system
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { addPlan, deletePlan, duePlans, listPlans, markReminded, updatePlan } from "../src/plans.ts";
import { openDb } from "../src/db.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { registerPlanTools } from "../src/tools/plans.ts";
import { BotService } from "../src/bot/service.ts";
import { loadBotConfig } from "../src/bot/config.ts";

const tmpDir = "data/tmp-plans";
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const db = openDb(join(tmpDir, "memory.db"));
  const registry = new ToolRegistry();
  registerPlanTools(registry, { db });

  console.log("=== ① 四项必填 ===");
  const bad = await registry.call("plan_add", { what: "读一本书", why: "想学", anchor: "学习" });
  check("缺提醒间隔被拒", bad.ok === false && bad.text.includes("提醒间隔"), bad.text);
  const bad2 = await registry.call("plan_add", { what: "读一本书", why: "想学", intervalMinutes: 30 });
  check("缺锚点被拒", bad2.ok === false && bad2.text.includes("锚点"), bad2.text);
  const bad3 = await registry.call("plan_add", { what: "", why: "", intervalMinutes: 0, anchor: "" });
  check("四项全缺时会一次点清", bad3.ok === false && bad3.text.split("、").length >= 3, bad3.text);

  console.log("\n=== ② 增删改查 ===");
  const made = await registry.call("plan_add", {
    what: "把记忆的召回逻辑再过一遍",
    why: "最近检索老是漏掉旧事",
    intervalMinutes: 60,
    anchor: "记忆系统",
  });
  check("建成功", made.ok, made.text.slice(0, 60));
  const id = listPlans(db, { status: "active" })[0]?.id ?? "";
  check("列表里有它", listPlans(db, { status: "active" }).some((p) => p.id === id));
  const upd = await registry.call("plan_update", { id, intervalMinutes: 30, why: "改成想每天提醒一次" });
  check("能改间隔和原因", upd.ok, upd.text.slice(0, 50));
  check("改动生效", listPlans(db, { status: "active" })[0]?.intervalMinutes === 30);
  const resched = await registry.call("plan_update", { id, remindAt: Date.now() + 5 * 60_000 });
  check("能改下次提醒时间（再定一次）", resched.ok);
  const done = await registry.call("plan_done", { id });
  check("能标完成", done.ok, done.text);
  check("完成后不在 active 里", listPlans(db, { status: "active" }).length === 0);
  check("done 里能看到", listPlans(db, { status: "done" }).length === 1);
  const del = await registry.call("plan_delete", { id });
  check("能删除", del.ok, del.text);
  check("删完就没了", listPlans(db, { status: "all" }).length === 0);

  console.log("\n=== ③ 到点提醒 ===");
  const p1 = addPlan(db, { what: "给她写个计划表", why: "她需要自己排事", intervalMinutes: 10, anchor: "计划表", remindAt: Date.now() - 1000 });
  check("建了一条已到点的", p1.ok && duePlans(db).length === 1);
  const first = duePlans(db)[0];
  const after = markReminded(db, first.id);
  check("提醒后下次时间被推后一个间隔", !!after && after.remindAt > Date.now() + 9 * 60_000, after ? String(after.intervalMinutes) : "");
  check("提醒后不再算到点", duePlans(db).length === 0);
  check("记了提醒次数", (after?.remindCount ?? 0) === 1);

  console.log("\n=== ④ 锚点关联 ===");
  const before = Number(db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c ?? 0);
  addPlan(db, { what: "占位", why: "测试新建锚点", intervalMinutes: 5, anchor: "全新锚点xyz" });
  const after2 = Number(db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c ?? 0);
  check("新锚点会被建出来", after2 === before + 1, `${before} → ${after2}`);
  const again = addPlan(db, { what: "占位2", why: "测试复用锚点", intervalMinutes: 5, anchor: "全新锚点xyz" });
  check("同名锚点复用不重复建", Number(db.prepare("SELECT COUNT(*) AS c FROM anchors").get()?.c ?? 0) === after2);
  check("计划上带着锚点名", listPlans(db, { status: "active" }).some((p) => p.anchorName === "全新锚点xyz"));

  console.log("\n=== ⑤ 真进提示词 ===");
  db.prepare("DELETE FROM plans").run();
  addPlan(db, { what: "去读那条视频的字幕", why: "想知道它到底讲了什么", intervalMinutes: 15, anchor: "B站", remindAt: Date.now() - 1000 });
  const base = loadBotConfig();
  const cfg = {
    ...base,
    dataDir: tmpDir,
    memoryDb: join(tmpDir, "memory.db"),
    deepseekBaseUrl: "http://127.0.0.1:59998",
    deepseekApiKey: "k",
    toolsEnabled: false,
    allowPrivate: [10000001],
    allowGroups: [],
    autonomyEnabled: false,
    proactiveEnabled: false,
  };
  const captured: string[] = [];
  const svc = new BotService(cfg, {
    replyAdapter: {
      name: "cap",
      complete: async (messages: Array<{ content: string }>) => {
        captured.push(messages.map((m) => m.content).join("\n"));
        return "嗯。";
      },
    } as never,
  });
  await svc.handle({ sessionId: "private:10000001", userId: 10000001, userName: "测试", text: "在吗", isGroup: false, selfId: base.selfId });
  const sysText = captured[0] ?? "";
  check("聊天提示词里没有计划提醒（提醒只在走神里）", !sysText.includes("【计划到点了】"));
  const blockText = (await import("../src/plans.ts")).planPromptBlock((await import("../src/plans.ts")).duePlans(db));
  check("计划提醒块本身带事和原因", blockText.includes("去读那条视频的字幕") && blockText.includes("想知道它到底讲了什么"));
  check("提醒里说明了可以改时间/可以做完了", blockText.includes("plan_update") && blockText.includes("plan_done"));
  check("聊天没消费提醒（下次还在）", duePlans(db).length === 1);
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
