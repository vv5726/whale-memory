import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 第二步：先窄后宽。
 *   recall 支持 allowMore（放宽到 12 个锚点）
 *   handle 里：第一轮生成不出东西（空/兜底），就放宽再召回一次，重试一轮。
 */
const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-step2-${ts}`);
mkdirSync(dir, { recursive: true });
for (const f of ["data/memory.db", "src/recall.ts", "src/bot/service.ts"]) {
  copyFileSync(f, join(dir, f.replace(/[\\/]/g, "_")));
}
console.log(`① 备份 → ${dir}`);

const restore = (why: string): never => {
  copyFileSync(join(dir, "src_recall.ts"), "src/recall.ts");
  copyFileSync(join(dir, "src_bot_service.ts"), "src/bot/service.ts");
  console.log(`✗ ${why} —— 已还原`);
  process.exit(1);
};

// ① recall：allowMore
{
  const p = "src/recall.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("allowMore")) {
    s = s.replace(
      "  const ACTIVATION_TOP = 6;",
      "  const ACTIVATION_TOP = opts.allowMore === true ? 12 : 6;",
    );
    // opts 类型里加字段
    s = s.replace("factTopK?: number", "factTopK?: number;\n  /** 第一轮没想出东西时放宽，再召回一批 */\n  allowMore?: boolean");
    writeFileSync(p, s, "utf8");
    console.log("② recall 支持 allowMore");
  } else {
    console.log("② recall 已有");
  }
}

// ② service：空回复时放宽重试
{
  const p = "src/bot/service.ts";
  let s = readFileSync(p, "utf8");
  const anchor = "      reply = this.stripNamePrefix(out.text);";
  if (!s.includes("宽松重试")) {
    if (!s.includes(anchor)) restore("找不到 service 的锚点");
    s = s.replace(
      anchor,
      [
        "      // 宽松重试：第一轮什么都没生成出来（或者只有一句兜底），",
        "      // 说明按前几个锚点想不出东西——放宽召回再试一次。",
        "      if (String(out.text).trim().length < 4) {",
        "        const wider = recall(this.db, this.memoryCfg, recallQuery, {",
        "          sessionId: evt.sessionId,",
        "          speakerId: String(evt.userId),",
        "          allowMore: true,",
        "        } as never);",
        "        const retry = buildChatPrompt({",
        "          memory: wider,",
        "          userName: evt.userName,",
        "          history: this.historyFor(evt.sessionId),",
        "          message: text,",
        "          memoryWeak: weak,",
        "          stats: this.liveStats(),",
        "          ...this.promptExtras(evt),",
        "        });",
        "        const out2 = await this.respond(retry);",
        "        if (String(out2.text).trim().length > 0) {",
        "          out.text = out2.text;",
        "          toolText = out2.toolText;",
        "        }",
        "      }",
        anchor,
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("③ service 加了宽松重试");
  } else {
    console.log("③ service 已有");
  }
}

// ③ 验证：真跑一句
const { execFileSync } = await import("node:child_process");
try {
  const out = execFileSync(
    process.execPath,
    [
      "-e",
      `import('./src/bot/config.ts').then(async ({loadBotConfig}) => {
        const { BotService } = await import('./src/bot/service.ts');
        const cfg = loadBotConfig();
        const svc = new BotService({ ...cfg, memoryDb: 'data/memory.db' });
        const r = await svc.handle({ userId: 10001, selfId: cfg.selfId, userName: '他',
          sender: { userId: 10001, card: '他' }, text: '你还记得小雨吗',
          isGroup: false, mentioned: true, sessionId: 'step2' });
        svc.close();
        console.log('R ' + String(r).slice(0, 60));
      }).catch(e => console.log('ERR ' + e.message))`,
    ],
    { encoding: "utf8", cwd: process.cwd(), timeout: 180_000 },
  );
  console.log("④ 真跑：" + (out.trim().split("\n").pop() ?? ""));
  if (out.includes("ERR")) restore("真跑失败：" + out.trim().slice(0, 120));
} catch (err) {
  restore("子进程失败：" + (err instanceof Error ? err.message : String(err)).slice(0, 120));
}

console.log("");
console.log(`成功。回滚用 ${dir}`);
