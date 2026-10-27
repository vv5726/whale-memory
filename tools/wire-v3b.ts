/**
 * 用 Node 读写（UTF-8 无损），静态 import 验证。失败自动还原。
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-v3b-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("data/memory.db", join(dir, "memory.db"));
copyFileSync("src/bot/service.ts", join(dir, "src_bot_service.ts"));
console.log(`① 备份 → ${dir}`);

const p = "src/bot/service.ts";
const src = readFileSync(p, "utf8");
const anchor =
  'this.extractAdapter = opts.extractAdapter ?? (cfg.provider === "deepseek" ? this.replyAdapter : undefined);';

if (!src.includes(anchor)) {
  console.log("✗ 找不到锚点，不改");
  process.exit(1);
}

if (src.includes("(this.memoryCfg as { extractV3?: boolean }).extractV3")) {
  console.log("② 已经有，跳过");
} else {
  writeFileSync(
    p,
    src.replace(
      anchor,
      [
        "// v3 开关必须显式带进抽取层：memoryCfg 是另一个对象，withOverrides 不会传过去",
        "(this.memoryCfg as { extractV3?: boolean }).extractV3 = (cfg as { extractV3?: boolean }).extractV3 === true;",
        anchor,
      ].join("\n    "),
    ),
    "utf8",
  );
  console.log("② 开关传递已插入");
}

const restore = (why: string): never => {
  copyFileSync(join(dir, "src_bot_service.ts"), p);
  console.log(`✗ ${why}——已还原`);
  process.exit(1);
};

// ③ 真跑一句（静态 import 的 BotService 已经是改完的版本？不是——ESM 已缓存）
//    所以这里改用子进程重新加载，确保跑的是磁盘上的新代码
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
        const r = await svc.handle({ userId: 999002, selfId: cfg.selfId, userName: '小红',
          sender: { userId: 999002, card: '小红' }, text: 'v3 接通了吗',
          isGroup: false, mentioned: true, sessionId: 'v3check' });
        svc.close();
        console.log('R ' + String(r).slice(0, 40));
      }).catch(e => console.log('ERR ' + e.message))`,
    ],
    { encoding: "utf8", cwd: process.cwd(), timeout: 180_000 },
  );
  console.log("③ 真跑输出：" + out.trim().split("\n").pop());
  if (out.includes("ERR")) restore("真跑失败：" + out.trim().slice(0, 120));
} catch (err) {
  restore("子进程失败：" + (err instanceof Error ? err.message : String(err)).slice(0, 120));
}

// ④ 确认 memoryCfg 真的带上了
const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });
const mem = (svc as unknown as { memoryCfg: { extractV3?: boolean } }).memoryCfg;
console.log(`④ memoryCfg.extractV3 = ${mem.extractV3}（bot.json 里 ${cfg.extractV3}）`);
svc.close();

console.log("");
console.log(`成功。回滚：${join(dir, "src_bot_service.ts")} → src/bot/service.ts`);
