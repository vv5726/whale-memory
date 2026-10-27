/**
 * 验证「每小时清空日志」真的会清空、而且不影响别的。
 * 用 200ms 的间隔代替 1 小时，验完就删临时文件。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startLogTruncation } from "../src/bot/logview.ts";

const dir = "data/tmp-log-rotate";
const file = join(dir, "bot.log");

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};
const size = (p: string) => (existsSync(p) ? statSync(p).size : -1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, "旧日志一行\n".repeat(100), "utf8");
  const before = size(file);
  check("清空前有内容", before > 0, `${before} 字节`);

  const stop = startLogTruncation(file, 200);
  await sleep(1300);
  const after = size(file);
  console.log(`  清空后文件：${after} 字节（含清空那一刻记的一行）`);

  // 清空后会写一行「[log] 整点清空日志」，所以不要求 0 字节，只要求「旧日志没了」
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  check("旧的那 100 行被清掉了", !text.includes("旧日志一行"));
  check("文件已经很小（不会无限长）", after < 500, `${after} 字节`);

  // 再来一轮，确认是「周期性」而不是只清一次
  writeFileSync(file, "第二轮旧日志\n".repeat(50), "utf8");
  await sleep(1300);
  const text2 = existsSync(file) ? readFileSync(file, "utf8") : "";
  check("第二轮也会被清掉（周期生效）", !text2.includes("第二轮旧日志"));

  // 停掉之后不再清
  stop();
  writeFileSync(file, "停掉之后写的\n", "utf8");
  await sleep(1300);
  check("stop() 之后不再清空", existsSync(file) && readFileSync(file, "utf8").includes("停掉之后写的"));
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
