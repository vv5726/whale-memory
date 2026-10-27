/**
 * 验证「它能看到自己日志」这个能力真的挂上了、而且拿得到东西。
 *
 * 不只看文件里有没有 read_log —— 走真的 buildTools，再真的调一次。
 */
import { ToolRegistry } from "../src/tools/registry.ts";
import { registerLogTools } from "../src/tools/logs.ts";
import { buildTools } from "../src/tools/index.ts";
import { loadBotConfig } from "../src/bot/config.ts";

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

// ① 走真实注册链路：bot 真正挂的工具清单里有没有它
console.log("=== ① 真的挂上去了 ===");
const cfg = loadBotConfig();
const real = buildTools({ ...cfg, dataDir: "data", toolsEnabled: true });
const names = real.names();
console.log(`  工具共 ${names.length} 个：${names.join("、")}`);
check("工具清单里有 read_log", names.includes("read_log"));

// ② 真的调一次
console.log("\n=== ② 真的读出来 ===");
const r1 = await real.call("read_log", { lines: 5 });
console.log(r1.text.split("\n").slice(0, 3).map((l) => `  ${l}`).join("\n"));
console.log("  …");
check("调用成功", r1.ok);
const bodyLines = r1.text.split("\n").slice(2);
check("给了 5 行（默认量级可调）", bodyLines.length === 5, `实际 ${bodyLines.length} 行`);
// 日志里一条回复可能带换行，尾巴里会混进续行（没有时间戳）——只要求有整理过的时间戳行
const stamped = bodyLines.filter((l) => /^\d{2}:\d{2}:\d{2} /.test(l));
check("时间戳被整理成人看的", stamped.length > 0, `${stamped.length}/${bodyLines.length} 行带时间`);
check("输出不至于撑爆上下文", r1.text.length <= 6100, `${r1.text.length} 字`);

// ③ 关键词过滤
const r2 = await real.call("read_log", { lines: 5, filter: "消息" });
const kept = r2.text.split("\n").slice(2);
check("关键词过滤：每行都含「消息」", kept.length > 0 && kept.every((l) => l.includes("消息")), `${kept.length} 行`);

// ④ 只看报错
const r3 = await real.call("read_log", { lines: 5, onlyErrors: true });
check("只看报错时不会崩", r3.ok, r3.text.split("\n")[1]?.slice(0, 30));

// ⑤ 行数上限
const r4 = await real.call("read_log", { lines: 9999 });
const capped = r4.text.split("\n").slice(2).length;
check("行数被夹在 200 以内", capped <= 200, `${capped} 行`);

// ⑥ 日志不存在时是好话，不是异常
const bare = new ToolRegistry();
registerLogTools(bare, "data/this-dir-does-not-exist");
const r5 = await bare.call("read_log", {});
check("没日志文件时说人话", r5.ok === false && r5.text.includes("没找到日志"), r5.text.slice(0, 40));

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
