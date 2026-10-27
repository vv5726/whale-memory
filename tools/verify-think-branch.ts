// 真跑一遍 thinkOnce：验证「途径=聊天但没内容」不再静默丢失
import { mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { AutonomyLoop } from "../src/bot/autonomy.ts";
import { loadBotConfig } from "../src/bot/config.ts";

const dir = "data/tmp-think";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(
  `${dir}/tuning.json`,
  JSON.stringify({ thinkChance: 1, thinkIdleSeconds: 0, thinkSettleSeconds: 0 }),
  "utf8",
);

const baseCfg = loadBotConfig() as unknown as Record<string, unknown>;
const cfg = { ...baseCfg, dataDir: dir, thinkEnabled: true, autonomyHours: [0, 24] } as never;

function makeService(raw: string, log: string[]) {
  return {
    toolRegistry: () => null,
    randomAnchor: () => ({ name: "阿牙易", kind: "person", memories: ["上次说要给我起外号"], related: [], repeats: 0 }),
    think: async () => raw,
    recordThoughtNote: () => undefined,
    busyRecently: () => false,
  } as never;
}

async function run(label: string, raw: string) {
  const spoke: string[] = [];
  const loop = new AutonomyLoop(cfg, makeService(raw, []), (t) => spoke.push(t));
  const r = await loop.thinkOnce();
  console.log(`${label}`);
  console.log(`  → thought=${r.thought} reason=${r.reason}`);
  console.log(`  → onSpeak 收到 ${spoke.length} 条：${JSON.stringify(spoke)}`);
  return { r, spoke };
}

const a = await run("① 途径=聊天，但消息是空的", "目的：问问他到哪了\n途径：聊天\n消息：\n给：他");
const b = await run("② 途径=聊天，消息只有引号", "途径：聊天\n消息：「」\n给：他");
const c = await run("③ 正常：途径=找人聊天，消息带引号", "途径：找人聊天\n消息：「在吗」\n给：他");
const d = await run("④ 途径=算了", "目的：没什么\n途径：算了\n消息：");

console.log("\n判定：");
console.log(`  ①没发出、且说的是「没写出内容」：${a.spoke.length === 0 && a.r.reason.includes("没写出内容") ? "✓" : "✗"}`);
console.log(`  ②没发出：${b.spoke.length === 0 ? "✓" : "✗"}`);
console.log(`  ③真发出且去掉引号：${c.spoke[0] === "在吗" ? "✓" : "✗ " + JSON.stringify(c.spoke)}`);
console.log(`  ④不发出：${d.spoke.length === 0 && !d.r.thought ? "✓" : "✗"}`);

rmSync(dir, { recursive: true, force: true });
