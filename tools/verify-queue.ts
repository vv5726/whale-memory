// 验证队列 + 批处理：
//   A 入队 / 去重 / 统计
//   B 销账 / 过期
//   C 触发条件（攒够 10 条 / 深任务 3 条 / 最老等 30 分钟）
//   D 端到端：批处理真跑一轮，销掉的算成、没销掉的标失败，手记留痕
//   E 批处理里拿不到手机和 bili_subtitle（大文本不进主上下文）
//
// 不花钱：fetch 被换掉，模型只会按剧本回答。
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { BatchRunner } from "../src/bot/batch.ts";
import { Reading } from "../src/bot/reading.ts";
import { addItem, describeItem, loadQueue, markItem, expireOld, queueStats, saveQueue, stampLocal } from "../src/queue.ts";

const TMP = "data/tmp-verify-queue";
const DB = join(TMP, "q.db");

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `　${detail}` : ""}`);
  if (!ok) fail += 1;
};

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
for (const f of ["persona.md", "speech-rules.md", "self.md", "tuning.json", "knowledge.json"]) {
  if (existsSync(join("data", f))) copyFileSync(join("data", f), join(TMP, f));
}
copyFileSync("data/memory.db", DB);

// ── A 入队 ──
console.log("=== A 入队 / 去重 / 统计 ===");
const a = addItem(TMP, { what: "查一下两千块还了没", why: "想起王建国", done: "能说出最近一次提到是哪天", kind: "light" });
check("入队成功", a.ok === true, a.item?.id ?? a.reason ?? "");
check("id 像 q20261028-1", /^q\d{8}-\d+$/.test(a.item?.id ?? ""), a.item?.id ?? "");
const dup = addItem(TMP, { what: "查一下两千块还了没", why: "又想起" });
check("同一件事不排两遍", dup.ok === false && /已经在队列里/.test(dup.reason ?? ""), dup.reason ?? "");
check("空 what 被拒", addItem(TMP, { what: "" }).ok === false);

addItem(TMP, { what: "想清楚我为什么总搞错人名", kind: "deep" });
addItem(TMP, { what: "读一下那个讲 harness 的视频", kind: "heavy" });
const s1 = queueStats(TMP);
check("统计对得上", s1.pending === 3 && s1.light === 1 && s1.deep === 1 && s1.heavy === 1, JSON.stringify(s1));

// ── B 销账 / 过期 ──
console.log("\n=== B 销账 / 过期 ===");
const id1 = a.item!.id;
check("标完成", markItem(TMP, id1, "done", "查到了：上周三还的") === true);
check("结果留住了", (loadQueue(TMP).find((i) => i.id === id1)?.result ?? "").includes("上周三"));
check("不存在的 id 返回 false", markItem(TMP, "q19990101-9", "done") === false);

const items = loadQueue(TMP);
items.push({ id: "q-old", at: stampLocal(new Date(Date.now() - 30 * 3_600_000)), kind: "light", why: "", what: "很久以前想做的事", done: "", status: "pending", tries: 0, result: "" });
saveQueue(TMP, items);
const dropped = expireOld(TMP, 24);
check("超过 24 小时的被丢掉", dropped === 1, String(dropped));
check("丢掉的标成 expired", loadQueue(TMP).find((i) => i.id === "q-old")?.status === "expired");

// ── D 端到端（先测触发条件）──
console.log("\n=== C 触发条件 ===");
const cfg = { ...loadBotConfig(), dataDir: TMP, memoryDb: DB, toolsEnabled: true, deepseekApiKey: "k" };
const svc = new BotService(cfg);
const batch = new BatchRunner(cfg, svc);

// 现在队列里只剩 1 条 light + 1 条 deep + 1 条 heavy，且刚建的（没等满 30 分钟）
const g1 = batch.shouldRun();
check("才 2 条、没等够 → 不跑", g1.ok === false, g1.reason);

saveQueue(TMP, []);
for (const w of ["查一下两千块还了没", "把手机里那个 App 卸了", "读一遍抽取规则的第九条", "把日记里上周三那段找出来", "算一下这个月话费还剩多少", "把表情包里重复的三张删了", "问问他那个项目上线没有", "把知识库里讲 harness 的条目补全"]) addItem(TMP, { what: w, kind: "light" });
const g2 = batch.shouldRun();
check("攒够 8 条 → 跑", g2.ok === true, g2.reason);

saveQueue(TMP, []);
for (const w of ["想清楚为什么总把称呼当线索", "复盘那次手术的对话我漏了什么", "想明白记忆压实该按什么顺序"]) addItem(TMP, { what: w, kind: "deep" });
const g3 = batch.shouldRun();
check("深任务攒够 3 条 → 跑", g3.ok === true, g3.reason);

saveQueue(TMP, []);
addItem(TMP, { what: "只等了一会儿", kind: "light" });
const old = loadQueue(TMP);
old[0]!.at = stampLocal(new Date(Date.now() - 91 * 60_000));
saveQueue(TMP, old);
const g4 = batch.shouldRun();
check("最老的等了 91 分钟 → 跑", g4.ok === true, g4.reason);

// ── A2 同主题合并 ──
console.log("\n=== A2 同一件事的不同说法要并进去 ===");
saveQueue(TMP, []);
const m1 = addItem(TMP, { what: "把「称呼只问一次」这条规矩固定下来", why: "一个称呼只问一次就够", kind: "light" });
check("第一条新开", m1.ok === true && m1.item?.merges === 1, JSON.stringify({ ok: m1.ok, merges: m1.item?.merges }));
const m2 = addItem(TMP, { what: "把那四句话里重复追问的毛病找出来，以后一个称呼只问一次", why: "重复追问", kind: "light" });
check("换个说法的同一件事 → 并进去", m2.merged === true, m2.reason ?? "");
check("并进去之后没有新开条目", loadQueue(TMP).length === 1, `${loadQueue(TMP).length} 条`);
check("次数记成了 2", loadQueue(TMP)[0]?.merges === 2, String(loadQueue(TMP)[0]?.merges));
check("两条 why 都留着", (loadQueue(TMP)[0]?.why ?? "").includes("／"), loadQueue(TMP)[0]?.why ?? "");
const m3 = addItem(TMP, { what: "把手机里那个没用的 App 卸了", why: "占地方", kind: "light" });
check("不相干的 → 照样新开", m3.ok === true && loadQueue(TMP).length === 2, `${loadQueue(TMP).length} 条`);
check("describeItem 会提示「想了 N 次」", describeItem(loadQueue(TMP)[0]!).includes("想了 2 次"), describeItem(loadQueue(TMP)[0]!).slice(0, 60));

// ── D 真跑一轮 ──
console.log("\n=== D 端到端：批处理真跑一轮 ===");
saveQueue(TMP, []);
const i1 = addItem(TMP, { what: "查一下两千块还了没", why: "想起王建国", done: "能说出最近一次提到是哪天", kind: "light" }).item!;
const i2 = addItem(TMP, { what: "把说话规矩里重复的两条合并", why: "规矩太长", kind: "deep" }).item!;
{ // 让它满足「攒够」条件
  const q = loadQueue(TMP);
  q[0]!.at = stampLocal(new Date(Date.now() - 91 * 60_000));
  saveQueue(TMP, q);
}

const seen: Array<{ tools: string[]; user: string }> = [];
let round = 0;
globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    tools?: Array<{ function?: { name?: string } }>;
    messages?: Array<{ role?: string; content?: string }>;
  };
  const tools = (body.tools ?? []).map((t) => String(t.function?.name ?? ""));
  const user = String(body.messages?.[body.messages.length - 1]?.content ?? "");
  seen.push({ tools, user });
  round += 1;
  if (round === 1) {
    // 第一轮：销掉 i1
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "queue_done", arguments: JSON.stringify({ id: i1.id, result: "查到了：上周三还的" }) },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: `第一件事做完了；第二件（${i2.id}）没想清楚，先放着` }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as unknown as typeof fetch;

const r = await batch.runOnce();
check("批处理跑了", r.ran === true, r.reason);
const after = loadQueue(TMP);
check("销掉的那条算成", after.find((i) => i.id === i1.id)?.status === "done", after.find((i) => i.id === i1.id)?.status ?? "");
check("没轮到的退回 pending（不是判死）", after.find((i) => i.id === i2.id)?.status === "pending", after.find((i) => i.id === i2.id)?.status ?? "");
check("没轮到的 tries 不涨", (after.find((i) => i.id === i2.id)?.tries ?? 0) === 0);
check("批处理指令里带了这两件事", seen[0]!.user.includes(i1.id) && seen[0]!.user.includes(i2.id));

// ── E 工具过滤 ──
console.log("\n=== E 批处理能拿到的工具 ===");
const tools0 = seen[0]!.tools;
check("没有手机工具", !tools0.some((n) => n.startsWith("phone_")), tools0.filter((n) => n.startsWith("phone_")).slice(0, 3).join("、"));
check("没有 bili_subtitle（字幕太长）", !tools0.includes("bili_subtitle"));
check("有 queue_done（要能销账）", tools0.includes("queue_done"));
check("工具是完整一套（不只是 3 个）", tools0.length > 20, `${tools0.length} 个`);

// 手记
console.log("\n=== 手记留痕 ===");
let journal = "";
try {
  const jf = join(TMP, "journal");
  const files = existsSync(jf) ? readdirSync(jf) : [];
  for (const f of files) journal += readFileSync(join(jf, f), "utf8");
} catch {
  journal = "";
}
check("手记里有「批处理」", journal.includes("批处理"));
check("手记里写了成/没成", /成 \d+ \/ 没成 \d+/.test(journal), journal.slice(0, 80));

// ── F heavy：走阅读员，不进批处理 ──
console.log("\n=== F heavy 走阅读员 ===");
saveQueue(TMP, []);
const hv = addItem(TMP, { what: "读一下讲 harness 的那个视频", why: "想知道 agent 和 harness 的边界", kind: "heavy" }).item!;

const g5 = new BatchRunner(cfg, svc).shouldRun();
check("只有 heavy 时，批处理不跑", g5.ok === false && /heavy/.test(g5.reason), g5.reason);
check("没有阅读员时 heavy 也不跑", batch.shouldRunHeavy().ok === false, batch.shouldRunHeavy().reason);

// 造一个带假阅读员的 Reading
const fakeReader = {
  read: async (task: string) => ({
    at: Date.now(),
    task,
    summary: "【读了】BV1harness 讲 agent/harness 的分层 —— 结论：工具和记忆属于 harness",
    toolsUsed: ["bili_search", "bili_subtitle"],
    videosRead: 1,
  }),
};
const heavyBatch = new BatchRunner(cfg, svc, { reading: new Reading(cfg, svc, fakeReader as never) });
const g6 = heavyBatch.shouldRunHeavy();
check("有阅读员 + 有 heavy → 该跑", g6.ok === true, g6.reason);

// 上一段批处理刚调过模型，busyRecently(30s) 还是 true；等它过去（这是真实约束，不是测试技巧）
await new Promise((r) => setTimeout(r, 31_000));

let learnSeen = "";
const prevFetch = globalThis.fetch;
globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role?: string; content?: string }> };
  learnSeen = String(body.messages?.[0]?.content ?? "");
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "读了：harness 管工具和记忆，模型只管说话。" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as unknown as typeof fetch;

const rh = await heavyBatch.runHeavyOnce();
globalThis.fetch = prevFetch;
check("heavy 跑起来了", rh.ran === true, rh.reason);
const hvAfter = loadQueue(TMP).find((i) => i.id === hv.id);
check("heavy 标成做完", hvAfter?.status === "done", hvAfter?.status ?? "");
check("结果写回队列", (hvAfter?.result ?? "").length > 5, hvAfter?.result ?? "");
check("学习轮真的跑了（拿到简报）", learnSeen.includes("agent/harness"));

const g7 = heavyBatch.shouldRunHeavy();
check("紧接着再问 → 隔 10 分钟，不跑", g7.ok === false && /10 分钟/.test(g7.reason), g7.reason);

svc.close();
for (const p of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(p)) rmSync(p);
rmSync(TMP, { recursive: true, force: true });

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
