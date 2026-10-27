/**
 * 验证「她能看到并修改自己的人格提示词」：
 *   · persona_read 读得到全文 + 固定底线
 *   · persona_write 写进 persona.md，且**下一次开口就生效**（真跑 buildChatPrompt）
 *   · 太短的拒绝；persona_reset 能还原
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildChatPrompt } from "../src/bot/persona.ts";
import { registerPersonaTools } from "../src/tools/persona.ts";
import { ToolRegistry } from "../src/tools/registry.ts";

const tmpDir = "data/tmp-persona-editable";
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

function promptSystem(): string {
  const msgs = buildChatPrompt({
    memory: { contextBlock: "（记忆）" },
    userName: "他",
    history: [],
    message: "你好",
    memoryWeak: false,
    selfText: "",
  });
  return String(msgs[0]?.content ?? "");
}

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const reg = new ToolRegistry();
  registerPersonaTools(reg, tmpDir);

  console.log("=== ① 出厂状态：能读到默认人格 ===");
  const r1 = await reg.call("persona", { action: "get" });
  check("persona get 成功", r1.ok);
  check("读到的是人格底色（不是空）", r1.text.includes("你在 QQ 上跟一个人聊天"));
  check("底线也给她看了", r1.text.includes("【底线（这一段改不了）】"));
  check("说明了来源（还没有 persona.md）", r1.text.includes("出厂默认"));

  console.log("\n=== ② 写一份新人格，下一次开口就生效 ===");
  const mine = "【我是怎么想事的】\n- 我先看结构，再看热闹：一件事先拆机制、因果、边界。\n- 我给判断，也给理由；不同意就说不同意，但只说一次。\n- 我话少，结论先行，不铺垫、不重复对方的话。\n- 我的弱点是慢半拍：对方要的是被接住，我常先给解法。所以先说一句「我在」，再谈怎么办。";
  const w = await reg.call("persona", { action: "set", text: mine });
  check("persona set 成功", w.ok, w.text);
  const file = join(tmpDir, "persona.md");
  check("真的写了 persona.md", existsSync(file) && readFileSync(file, "utf8").includes("我先看结构"));

  const r2 = await reg.call("persona", { action: "get" });
  check("再读就是新人格（来源变成文件）", r2.text.includes("我先看结构") && r2.text.includes("persona.md"));

  // 提示词走的是 DSH_DATA_DIR，这里指到临时目录再真拼一次
  const old = process.env.DSH_DATA_DIR;
  process.env.DSH_DATA_DIR = tmpDir;
  const sys = promptSystem();
  process.env.DSH_DATA_DIR = old;
  check("拼进 system 的是她新写的人格", sys.includes("我先看结构"));
  check("固定底线仍然在后面（改不掉）", sys.includes("【底线（这一段改不了）】"));
  check("旧默认人格没有混进来", !sys.includes("【不许吹牛】"));

  console.log("\n=== ③ 防呆 ===");
  const tooShort = await reg.call("persona", { action: "set", text: "我要变酷。" });
  check("太短被拒（至少 100 字）", tooShort.ok === false && tooShort.text.includes("太短"));
  const tooLong = await reg.call("persona", { action: "set", text: "长".repeat(6100) });
  check("太长被拒（6000 字以内）", tooLong.ok === false && tooLong.text.includes("太长"));

  const reset = await reg.call("persona", { action: "reset" });
  check("能恢复出厂默认", reset.ok && readFileSync(file, "utf8").includes("【不许吹牛】"));
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
