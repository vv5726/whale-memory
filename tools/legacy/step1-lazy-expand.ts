import { readFileSync, writeFileSync } from "node:fs";

/**
 * 第一步：展开改成「按分数排队，取够就停」。
 *
 * 原来：所有被激活的锚点一起参与累加 → 一次拉一大片。
 * 现在：只取分数最高的一小批，低于门槛的不参与；后面那几个不主动展开。
 */
const p = "src/recall.ts";
let s = readFileSync(p, "utf8");

const anchor = "  // 事件 → 被激活锚点的证据强度";
if (!s.includes(anchor)) {
  console.log("✗ 找不到锚点");
  process.exit(1);
}

if (s.includes("ACTIVATION_TOP")) {
  console.log("已经改过了");
  process.exit(0);
}

const inject = [
  "  // ★ 惰性展开：先只取分数最高的一小批锚点，低于门槛的不参与。",
  "  //   原来是把所有激活锚点一起累加，一次拉一大片，噪音多、token 也贵。",
  "  const ACTIVATION_TOP = 6;",
  "  const ACTIVATION_MIN = 0.15;",
  "  const rankedActivation = [...activationMap.entries()]",
  "    .filter(([, score]) => score >= ACTIVATION_MIN)",
  "    .sort((a, b) => b[1] - a[1])",
  "    .slice(0, ACTIVATION_TOP);",
  "  const liveActivation = new Map(rankedActivation);",
  "",
  anchor,
].join("\n");

s = s.replace(anchor, inject);
s = s.replace("    const act = activationMap.get(aid);", "    const act = liveActivation.get(aid);");

writeFileSync(p, s, "utf8");
console.log("✓ 展开已改成按分数取前 " + 6 + " 个（门槛 0.15）");
