import { addKnowledge, loadKb } from "../src/knowledge.ts";
import { stickerStats, loadIndex } from "../src/stickers.ts";

addKnowledge("data", {
  category: "工具",
  title: "sticker_prefetch：预下载一批表情包",
  content:
    "什么时候用：库太空、想换风格、或者发现想发的图老是搜不到。\n参数：queries 想补哪些类型（逗号分隔，如「猫猫,贴贴,无语」），不填用默认 26 个情绪词；perQuery 每个词存几张（1-6，默认 3）。\n注意：它会真去搜狗搜+下载，要十几到几十秒；库存上限 240 张，超了从最久没用的开始清。",
  source: "工具说明书",
});

const cards = loadKb("data").entries.filter((e) => e.category === "工具");
const s = stickerStats("data");
const byQuery = new Map<string, number>();
for (const r of loadIndex("data").items) byQuery.set(r.query, (byQuery.get(r.query) ?? 0) + 1);
console.log(`工具卡 ${cards.length} 张；sticker_prefetch 卡: ${cards.some((c) => c.title.includes("sticker_prefetch"))}`);
console.log(`表情包库存 ${s.count} 张，覆盖 ${byQuery.size} 个关键词：`);
console.log("  " + [...byQuery.entries()].map(([k, v]) => `${k}×${v}`).join("、"));
