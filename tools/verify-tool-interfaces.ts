/**
 * 查她手上到底有几个工具接口：
 *  ① 真构造一个 BotService（跟线上同一套 hooks），拦 ToolRegistry.register 记下每个工具
 *  ② 校验每个工具都有描述/参数/处理器，名字不重复
 *  ③ 起个假模型服务，真发一条消息，抓「发给 API 的 tools 数组」——
 *     这一步才证明接口真到她手上，而不是只写在代码里
 */
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ToolRegistry } from "../src/tools/registry.ts";
import { BotService } from "../src/bot/service.ts";
import { loadBotConfig } from "../src/bot/config.ts";

const tmpDir = "data/tmp-toolcheck";
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

const recorded: Array<{ name: string; desc: string; params: unknown; hasHandler: boolean }> = [];
const origRegister = ToolRegistry.prototype.register;
ToolRegistry.prototype.register = function (this: ToolRegistry, def: never) {
  const d = def as unknown as { name: string; description?: string; parameters?: unknown; handler?: unknown };
  recorded.push({ name: d.name, desc: String(d.description ?? ""), params: d.parameters, hasHandler: typeof d.handler === "function" });
  return origRegister.call(this, def);
};

const requests: Array<{ tools?: Array<{ function?: { name?: string } }> }> = [];
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    try {
      requests.push(JSON.parse(raw));
    } catch {
      requests.push({});
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "嗯。" } }] }));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const live = new DatabaseSync("data/memory.db");
  live.exec(`VACUUM INTO '${join(tmpDir, "memory.db").replace(/\\/g, "/")}'`);
  live.close();

  const base = loadBotConfig();
  const cfg = {
    ...base,
    dataDir: "data",
    memoryDb: join(tmpDir, "memory.db"),
    deepseekBaseUrl: `http://127.0.0.1:${port}`,
    deepseekApiKey: "test",
    toolsEnabled: true,
    allowPrivate: [10000001],
    allowGroups: [],
    idleSleepMinutes: 999,
    dailySleepHour: null,
    autonomyEnabled: false,
    proactiveEnabled: false,
  };

  const svc = new BotService(cfg, {});
  console.log(`\n=== ① 注册表里一共 ${recorded.length} 个工具 ===`);
  const names = recorded.map((r) => r.name);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  check("名字没有重复", dup.length === 0, dup.join(","));
  const noDesc = recorded.filter((r) => r.desc.trim().length < 6);
  check("每个都有描述", noDesc.length === 0, noDesc.map((r) => r.name).join(","));
  const noHandler = recorded.filter((r) => !r.hasHandler);
  check("每个都有 handler", noHandler.length === 0, noHandler.map((r) => r.name).join(","));
  const badSchema = recorded.filter((r) => !r.params || (r.params as { type?: string }).type !== "object");
  check("参数都是 object schema", badSchema.length === 0, badSchema.map((r) => r.name).join(","));

  console.log("\n=== ② 按前缀分组 ===");
  const groups = new Map<string, string[]>();
  for (const n of names) {
    const g = n.includes("_") ? n.split("_")[0] : "其他";
    groups.set(g, [...(groups.get(g) ?? []), n]);
  }
  for (const [g, list] of [...groups.entries()].sort()) console.log(`  ${g.padEnd(8)} ${String(list.length).padStart(2)}  ${list.join(" ")}`);

  console.log("\n=== ③ 真发一条消息，抓发给 API 的 tools ===");
  await svc.handle({
    sessionId: "private:10000001",
    userId: 10000001,
    userName: "测试",
    text: "在吗",
    isGroup: false,
    selfId: base.selfId,
  });
  const apiTools = (requests.find((r) => Array.isArray(r.tools))?.tools ?? []).map((t) => t.function?.name ?? "");
  check("API 请求里带了 tools", apiTools.length > 0, `tools=${apiTools.length}`);
  check("接口数量和注册表一致", apiTools.length === recorded.length, `${apiTools.length} vs ${recorded.length}`);
  const missing = names.filter((n) => !apiTools.includes(n));
  check("注册的每个工具都真交给了模型", missing.length === 0, missing.join(","));

  console.log("\n=== ④ 抽查关键接口 ===");
  for (const key of ["sticker_send", "memes_recent", "persona_write", "think_prompt_write", "think_knobs_write", "tool_audit", "see_image", "memory_settle", "group_members", "bili_subtitle"]) {
    check(key, apiTools.includes(key));
  }

  svc.close();
} finally {
  server.close();
  ToolRegistry.prototype.register = origRegister;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
