/**
 * 用 Node 读写（UTF-8 无损），不用 PowerShell —— 今天所有损坏都出在那上面。
 *
 * 步骤：
 *   ① 备份（数据库 + 要改的源码）
 *   ② 在 service.ts 里把 extractV3 开关传给抽取层
 *   ③ 立刻验证：能 import 吗？能真跑一句吗？
 *   ④ 任何一步失败 → 从备份还原，退出码 1
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-v3-${ts}`);
mkdirSync(dir, { recursive: true });

for (const f of ["data/memory.db", "src/bot/service.ts", "src/llm/extract.ts"]) {
  copyFileSync(f, join(dir, f.replace(/[\\/]/g, "_")));
}
console.log(`① 备份 → ${dir}`);

const restore = (): void => {
  copyFileSync(join(dir, "src_bot_service.ts"), "src/bot/service.ts");
  console.log("↩ 已还原 service.ts");
};

const p = "src/bot/service.ts";
const src = readFileSync(p, "utf8");

const anchor = 'this.extractAdapter = opts.extractAdapter ?? (cfg.provider === "deepseek" ? this.replyAdapter : undefined);';
if (!src.includes(anchor)) {
  console.log("✗ 找不到锚点，什么都没改");
  process.exit(1);
}
if (src.includes("extractV3 === true")) {
  console.log("✓ 已经有这一段了，不用改");
} else {
  const patched = src.replace(
    anchor,
    [
      "// v3 开关必须显式带进抽取层：memoryCfg 是另一个对象，withOverrides 不会传过去",
      '(this.memoryCfg as { extractV3?: boolean }).extractV3 = (cfg as { extractV3?: boolean }).extractV3 === true;',
      anchor,
    ].join("\n    "),
  );
  writeFileSync(p, patched, "utf8");
  console.log("② 已插入开关传递");
}

// ③ 验证：语法
try {
  await import("../src/bot/service.ts");
  console.log("③ 语法通过");
} catch (err) {
  console.log("✗ 语法失败：" + (err instanceof Error ? err.message : String(err)));
  restore();
  process.exit(1);
}

// ④ 验证：真跑一句
try {
  const { loadBotConfig } = await import("../src/bot/config.ts");
  const { BotService } = await import("./src/bot/service.ts");
  const cfg = loadBotConfig();
  const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });
  const r = await svc.handle({
    userId: 999002,
    selfId: cfg.selfId,
    userName: "小红",
    sender: { userId: 999002, card: "小红" },
    text: "v3 接通了吗",
    isGroup: false,
    mentioned: true,
    sessionId: "v3check",
  });
  svc.close();
  console.log(`④ 真跑通过：${String(r).slice(0, 40)}`);
  console.log(`   开关读到：${cfg.extractV3}`);
} catch (err) {
  console.log("✗ 真跑失败：" + (err instanceof Error ? err.message : String(err)));
  restore();
  process.exit(1);
}

console.log("");
console.log("成功。回滚用：" + join(dir, "src_bot_service.ts") + " → src/bot/service.ts");
