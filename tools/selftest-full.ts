/** 重启前的完整自测：每个改动都真跑一次 */
import { loadBotConfig } from "../src/bot/config.ts";

const cfg = loadBotConfig();
let fail = 0;

const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail += 1;
};

// ① 模块能不能加载
try {
  const { BotService } = await import("../src/bot/service.ts");
  const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });

  // ② 守卫：陈述句不该被拦
  const guard = svc as unknown as { asksAboutPast: (t: string) => boolean };
  check("陈述句「之前的做法不对」不拦", guard.asksAboutPast("之前的做法不对") === false);
  check("问句「你还记得小雨吗」要拦", guard.asksAboutPast("你还记得小雨吗") === true);

  // ③ 历史窗口
  const hist = (svc as unknown as { historyFor: (s: string) => unknown[] }).historyFor("selftest");
  check("历史能取到 ≥30 条", Array.isArray(hist) && hist.length >= 30, `${Array.isArray(hist) ? hist.length : 0} 条`);

  // ④ 真正回一轮
  const reply = await svc.handle({
    userId: 10001,
    selfId: cfg.selfId,
    userName: "他",
    text: "自测：你记得我们刚才在弄什么吗",
    isGroup: false,
    mentioned: false,
    sessionId: "selftest",
  });
  check("能正常回话", typeof reply === "string" && reply.length > 0, String(reply).slice(0, 50));
  check("回答没被名字前缀污染", !String(reply).startsWith("凝："), String(reply).slice(0, 20));

  // ⑤ 工具表
  const names = svc.toolRegistry()?.names() ?? [];
  check("工具有 memory_list", names.includes("memory_list"));
  check("工具有 memory_why", names.includes("memory_why"));
  check("工具有 memory_forget", names.includes("memory_forget"));
  check("工具有 memory_about_person", names.includes("memory_about_person"));

  // ⑥ 查重强化
  const { recordOwnNote } = await import("../src/notes.ts");
  const db = (svc as unknown as { db: Parameters<typeof recordOwnNote>[0] }).db;
  const before = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
  const tag = `自测${Math.random().toString(36).slice(2, 10)}：完全独特的一句话用来试查重`;
  recordOwnNote(db, tag, Date.now());
  recordOwnNote(db, tag, Date.now());
  const after = Number(db.prepare("SELECT COUNT(*) AS c FROM events WHERE archived = 0").get()?.c ?? 0);
  check("同一句写两遍只 +1", after - before === 1, `${before} → ${after}`);

  // ⑦ 设备锁
  const lock = await import("../src/device-lock.ts");
  const r1 = await lock.acquireDevice(2000);
  let waited = false;
  const p2 = lock.acquireDevice(2000).then((rel) => {
    waited = true;
    rel();
  });
  setTimeout(() => r1(), 300);
  await p2;
  check("设备锁会串行", waited);

  svc.close();
} catch (err) {
  check("模块加载 / 运行", false, err instanceof Error ? err.message : String(err));
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
