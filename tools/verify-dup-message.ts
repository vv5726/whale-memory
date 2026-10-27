/**
 * 验证「同一条消息被算两遍」修好了。
 *
 * 场景就是线上那个：冷启动 → handle() 先把当前这句 ingest 进 turns 表
 * → historyFor 从表里回填 50 条 → 当前这句既在 history 里、又当 message。
 * 一个 QQ 自带表情包就被读成「两个 524，同一个表情发了两遍」。
 */
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ingestTurns } from "../src/extract.ts";
import { dayKey } from "../src/util.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService, withoutCurrent } from "../src/bot/service.ts";
import { buildChatPrompt } from "../src/bot/persona.ts";

const tmpDb = "data/tmp-dup-check.db";
const sticker = "[发了个表情：流泪]";
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

try {
  if (existsSync("data/memory.db")) copyFileSync("data/memory.db", tmpDb);
  const cfg = loadBotConfig();
  const svc = new BotService({ ...cfg, memoryDb: tmpDb, toolsEnabled: false });
  const db = (svc as unknown as { db: DatabaseSync }).db;
  const historyFor = (svc as unknown as { historyFor: (s: string) => Array<{ role: "user" | "assistant"; text: string }> })
    .historyFor.bind(svc);

  // 真实库里本来就有同文的历史消息（她当时真发过好几次），先清掉，否则断言没法确定
  db.prepare("DELETE FROM turns WHERE text = ?").run(sticker);

  // 冷启动的顺序：先落库，再第一次拿历史（内存里还是空的）
  ingestTurns(db, [{ day: dayKey(Date.now()), role: "user", text: sticker, speakerId: "10001" }]);
  const rawHist = historyFor("dup-test");

  check("bug 前提成立：裸回填的历史里带了当前这句", rawHist.some((h) => h.text === sticker));
  check("historyFor 返回的是带 speaker 的历史", rawHist.length > 0, `${rawHist.length} 条`);

  const fixed = withoutCurrent(rawHist, sticker);
  check("withoutCurrent 把当前这句剔掉了", !fixed.some((h) => h.text === sticker));
  check("只剔一条，历史长度 -1", fixed.length === rawHist.length - 1, `${rawHist.length} → ${fixed.length}`);

  // 真的验收：拼出来的 prompt 里，「这一句」作为独立一条只出现一次。
  // 注意不能用子串计数：历史里有条真消息是「[发了个表情：流泪]表情啊」，它是另一句话。
  const msgs = buildChatPrompt({
    memory: { contextBlock: "（记忆）" },
    userName: "他",
    history: fixed as never,
    message: sticker,
    memoryWeak: false,
    selfText: "",
  });
  const exact = msgs.filter((m) => m.content === sticker).length;
  check("prompt 里这句作为独立一条只出现一次", exact === 1, `${exact} 条`);
  check("历史里没有把当前这句再塞一遍", fixed.every((h) => h.text !== sticker));

  // 反例：真正连着发了两句一样的，前一句必须留着
  const twice = [...rawHist, { role: "user" as const, text: sticker }];
  const keep = withoutCurrent(twice as never, sticker);
  check("对方真的连发两句时，前一句仍然保留", keep.filter((h) => h.text === sticker).length === 1);

  // 最后一句是自己的时候不许乱剔
  const afterReply = [...rawHist, { role: "assistant" as const, text: "汪。" }];
  check("最后一句是它自己时不动历史", withoutCurrent(afterReply as never, sticker).length === afterReply.length);

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
