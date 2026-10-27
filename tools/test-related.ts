import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const cfg = loadBotConfig();
const svc = new BotService({ ...cfg, memoryDb: "data/memory.db" });

const anchor = svc.randomAnchor([]);
if (!anchor) {
  console.log("没有锚点");
  process.exit(0);
}

console.log(`想起：${anchor.name}（${anchor.kind}）`);
console.log(`直接挂在它上面的记忆：${anchor.memories.length} 条`);
const rel = (anchor as { related?: Array<{ name: string; weight: number; memories: string[] }> }).related ?? [];
console.log(`顺着关系网想到：${rel.length} 个`);
for (const r of rel) {
  console.log(`  〔${r.name}〕权重 ${r.weight.toFixed(1)}，${r.memories.length} 条记忆`);
  for (const m of r.memories) console.log(`     - ${m.slice(0, 60)}`);
}

console.log("\n=== 让它在这些基础上想一次 ===");
const raw = await svc.think({ ...anchor, repeats: 0 });
console.log(raw.trim().slice(0, 600));
svc.close();
