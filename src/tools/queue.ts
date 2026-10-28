import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { addItem, describeItem, loadQueue, markItem, queueStats } from "../queue.ts";

/**
 * 队列工具：她自己记账、看账、销账。
 *
 * 走神只拿 queue_add——它「决定要做什么」之后就写进队列，攒够了由批处理一次性做掉。
 * 以前它是立刻动手，一天 188 次、每次一整轮模型请求。
 */
export function registerQueueTools(registry: ToolRegistry, opts: { dataDir: string }): void {
  const tools: ToolDefinition[] = [
    {
      name: "queue_add",
      description:
        "把「要做的事」记进待办队列，攒够了一起做（不是现在就做）。\n\n" +
        "kind：light=查一下/记一条/改规矩（会攒批处理）；deep=需要想清楚的（每批最多 3 条）；heavy=要看 B 站/读屏/读长文件（单独走阅读员，不进批处理）。\n" +
        "done 写「做完什么样算完成」——不写的话批处理时容易敷衍成「做完了」。",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["light", "deep", "heavy"], description: "默认 light" },
          what: { type: "string", description: "要做什么（一句话，具体）" },
          why: { type: "string", description: "为什么想做" },
          done: { type: "string", description: "做完什么样算完成" },
        },
        required: ["what"],
      },
      handler: async (args) => {
        const r = addItem(opts.dataDir, {
          kind: String(args.kind ?? "light"),
          what: String(args.what ?? ""),
          why: String(args.why ?? ""),
          done: String(args.done ?? ""),
        });
        if (r.merged) {
          return { ok: true, text: `${r.reason ?? "并进同一件事了"}（队列 ${r.total} 条）` };
        }
        if (!r.ok) return { ok: false, text: r.reason ?? "没记进去" };
        return { ok: true, text: `记下了（${r.item!.id}）。队列里现在 ${r.total} 件事，攒够了一起做。` };
      },
    },
    {
      name: "queue_list",
      description: "看自己的待办队列：还没做的、做过的、失败的各有哪些。",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "done", "failed", "expired", "all"], description: "默认 pending" },
          limit: { type: "number", description: "最多几条（默认 20）" },
        },
        required: [],
      },
      handler: async (args) => {
        const status = String(args.status ?? "pending");
        const limit = Math.max(1, Math.min(60, Number(args.limit ?? 20)));
        const all = loadQueue(opts.dataDir);
        const list = (status === "all" ? all : all.filter((i) => i.status === status)).slice(-limit);
        const s = queueStats(opts.dataDir);
        const head = `队列：待做 ${s.pending}（轻 ${s.light} / 深 ${s.deep} / 重 ${s.heavy}）｜做过 ${s.done}｜失败 ${s.failed}｜过期 ${s.expired}`;
        if (list.length === 0) return { ok: true, text: `${head}\n（${status} 是空的）` };
        return { ok: true, text: `${head}\n\n${list.map((i, n) => describeItem(i, n + 1)).join("\n\n")}` };
      },
    },
    {
      name: "queue_done",
      description: "把队列里的一件事销掉：做完了写结果，做不了就标失败（会留着，下次再试）。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "队列项的 id（q20261028-3 这种）" },
          result: { type: "string", description: "一句话结果：做成了什么 / 为什么做不了" },
          ok: { type: "boolean", description: "默认 true；做不了就传 false" },
        },
        required: ["id"],
      },
      handler: async (args) => {
        const id = String(args.id ?? "").trim();
        const okFlag = args.ok === undefined ? true : Boolean(args.ok);
        const done = markItem(opts.dataDir, id, okFlag ? "done" : "failed", String(args.result ?? ""));
        if (!done) return { ok: false, text: `队列里没有 ${id}` };
        return { ok: true, text: `${id} 已标成${okFlag ? "做完" : "没做成"}。` };
      },
    },
  ];

  for (const t of tools) registry.register(t);
}
