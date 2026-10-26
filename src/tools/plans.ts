import type { DatabaseSync } from "node:sqlite";
import { loadTuning } from "../tuning.ts";
import {
  addPlan,
  archivePlanToMemory,
  deletePlan,
  duePlans,
  fmtPlan,
  fmtTime,
  getPlan,
  listPlans,
  markReminded,
  updatePlan,
} from "../plans.ts";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 计划表工具。
 *
 * 她可以：建（四项必填 + 锚点）、看、改任何一条、删、标完成。
 * 到点提醒由 promptExtras 注入（不是工具），所以这里还提供一个 plan_due 方便它自查。
 */
export function registerPlanTools(registry: ToolRegistry, hooks: { db: DatabaseSync; dataDir?: string }): void {
  const add: ToolDefinition = {
    name: "plan_add",
    description:
      "给自己定一条计划。四样必须全给：要干什么、为什么要干、提醒间隔、关联锚点（定计划的时间自动记）。少一样会被拒。",
    parameters: {
      type: "object",
      properties: {
        what: { type: "string", description: "准备去干什么，一句话" },
        why: { type: "string", description: "为什么要干这件事——写真的动机，不写套话" },
        intervalMinutes: { type: "number", description: "每隔多少分钟提醒一次" },
        intervalHours: { type: "number", description: "每隔多少小时提醒一次（比 intervalMinutes 省事：3 = 3 小时；优先用它）" },
        anchor: { type: "string", description: "关联的锚点（人事/主题名，比如「记忆系统」「王鑫」）；没有就新建一个" },
        remindInMinutes: { type: "number", description: "想「多少分钟后」提醒就用它，不用自己算时间戳" },
        remindInHours: { type: "number", description: "想「多少小时后」提醒就用它" },
        remindAt: { type: "number", description: "也可以直接给绝对时间（毫秒时间戳）" },
      },
      required: ["what", "why", "anchor"],
    },
    handler: async (args) => {
      const r = addPlan(hooks.db, {
        what: String(args.what ?? ""),
        why: String(args.why ?? ""),
        intervalMinutes: args.intervalMinutes === undefined ? undefined : Number(args.intervalMinutes),
        intervalHours: args.intervalHours === undefined ? undefined : Number(args.intervalHours),
        anchorName: String(args.anchor ?? ""),
        remindAt: args.remindAt === undefined ? undefined : Number(args.remindAt),
        remindInMinutes: args.remindInMinutes === undefined ? undefined : Number(args.remindInMinutes),
        remindInHours: args.remindInHours === undefined ? undefined : Number(args.remindInHours),
      });
      return { ok: r.ok, text: r.text };
    },
  };
  registry.register(add);

  const list: ToolDefinition = {
    name: "plan_list",
    description: "看自己的计划表（默认只看进行中的）。到点没到点都列出来，带原因、定于什么时候、下次提醒、关联锚点。",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "active（默认）/ done / all" },
        anchor: { type: "string", description: "只看某个锚点下的计划" },
      },
    },
    handler: async (args) => {
      const status = String(args.status ?? "active");
      const rows = listPlans(hooks.db, {
        status: status === "done" ? "done" : status === "all" ? "all" : "active",
        anchor: args.anchor === undefined ? undefined : String(args.anchor),
      });
      if (rows.length === 0) return { ok: true, text: "计划表是空的。" };
      return { ok: true, text: rows.map((p) => `- ${p.id}｜${fmtPlan(p)}`).join("\n") };
    },
  };
  registry.register(list);

  const due: ToolDefinition = {
    name: "plan_due",
    description: "看现在有没有到点的计划（到了的会顺便记一次提醒，并把下次往后推一个间隔）。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const rows = duePlans(hooks.db);
      if (rows.length === 0) return { ok: true, text: "现在没有到点的计划。" };
      const lines = rows.map((p) => `- ${p.id}｜${fmtPlan(p)}`);
      for (const p of rows) markReminded(hooks.db, p.id);
      return { ok: true, text: ["到点了：", ...lines, "", "要做就做完 plan_done，要改时间就 plan_update。"].join("\n") };
    },
  };
  registry.register(due);

  const update: ToolDefinition = {
    name: "plan_update",
    description:
      "改计划表里的任何一条：干什么、为什么、提醒间隔、下次提醒时间、锚点、状态。只传要改的字段。改时间就等于「再定一次」。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "计划 id（plan_list 里有）" },
        what: { type: "string" },
        why: { type: "string" },
        intervalMinutes: { type: "number" },
        intervalHours: { type: "number", description: "改成每几小时提醒一次" },
        remindAt: { type: "number", description: "下次提醒的绝对时间（毫秒时间戳）" },
        remindInMinutes: { type: "number", description: "多少分钟后再提醒（不用算时间戳）" },
        remindInHours: { type: "number", description: "多少小时后再提醒" },
        anchor: { type: "string" },
        status: { type: "string", description: "active / done" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      const r = updatePlan(hooks.db, {
        id: String(args.id ?? ""),
        what: args.what === undefined ? undefined : String(args.what),
        why: args.why === undefined ? undefined : String(args.why),
        intervalMinutes: args.intervalMinutes === undefined ? undefined : Number(args.intervalMinutes),
        intervalHours: args.intervalHours === undefined ? undefined : Number(args.intervalHours),
        remindAt: args.remindAt === undefined ? undefined : Number(args.remindAt),
        remindInMinutes: args.remindInMinutes === undefined ? undefined : Number(args.remindInMinutes),
        remindInHours: args.remindInHours === undefined ? undefined : Number(args.remindInHours),
        anchorName: args.anchor === undefined ? undefined : String(args.anchor),
        status: args.status === "done" ? "done" : args.status === "active" ? "active" : undefined,
      });
      return { ok: r.ok, text: r.text };
    },
  };
  registry.register(update);

  const done: ToolDefinition = {
    name: "plan_done",
    description:
      "把一条计划标成做完了。计划不删（plan_list status=done 还能看），同时写成一条记忆事件挂到锚点上。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "计划 id" },
        memoryValue: { type: "number", description: "这条记忆值几分 0-10（不填就用你自己设的那个值）" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      const id = String(args.id ?? "");
      const plan = getPlan(hooks.db, id);
      if (!plan) return { ok: false, text: `没有这个计划：${id}` };
      const r = updatePlan(hooks.db, { id, status: "done" });
      if (!r.ok) return { ok: false, text: r.text };
      // 不删计划：标完成 + 写成一条记忆事件挂到锚点上，以后能检索到
      const fallback = hooks.dataDir ? loadTuning(hooks.dataDir).planDoneMemoryValue : 6;
      const value = args.memoryValue === undefined ? fallback : Number(args.memoryValue);
      const mem = archivePlanToMemory(hooks.db, r.plan!, Date.now(), value);
      return { ok: true, text: `做完了：${plan.what}\n${mem.text}（记忆分 ${value}）` };
    },
  };
  registry.register(done);

  const remove: ToolDefinition = {
    name: "plan_delete",
    description: "删掉一条计划（确定它不再需要了再用；想保留记录就 plan_done）。",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "计划 id" } },
      required: ["id"],
    },
    handler: async (args) => {
      const r = deletePlan(hooks.db, String(args.id ?? ""));
      return { ok: r.ok, text: r.text };
    },
  };
  registry.register(remove);

  const soon = {
    name: "plan_soon",
    description: "看接下来最近的几条计划（不记提醒，只是看看）。",
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "看几条，默认 5" } },
    },
    handler: async (args) => {
      const limit = Math.max(1, Math.min(20, Number(args.limit ?? 5)));
      const rows = listPlans(hooks.db, { status: "active" }).slice(0, limit);
      if (rows.length === 0) return { ok: true, text: "最近没有计划。" };
      return { ok: true, text: rows.map((p) => `- ${p.id}｜${p.what}｜下次 ${fmtTime(p.remindAt)}`).join("\n") };
    },
  } as ToolDefinition;
  registry.register(soon);
}
