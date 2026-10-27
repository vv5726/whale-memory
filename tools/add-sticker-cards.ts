import { addKnowledge, loadKb } from "../src/knowledge.ts";

addKnowledge("data", {
  category: "工具",
  title: "sticker_send：发一张表情包",
  content:
    "什么时候用：笑、无语、委屈、想贴贴、要安慰的时候。讲正事、他难受的时候不发。\n参数：query 想要什么类型（「猫猫无语」「委屈」「贴贴」「晚安」），不填就随便挑；text 想配一句话（可选）。\n注意：库里没有合适的会去搜狗搜，搜到的会存进库；每小时最多发 6 张，同一张 30 分钟内不会重复；没有合适的就不发，别硬凑。",
  source: "工具说明书",
});

addKnowledge("data", {
  category: "工具",
  title: "sticker_library：看看表情包库存",
  content:
    "什么时候用：想知道自己收了多少表情包、用过几张、占多少磁盘；或者清理很久没用过的。\n参数：prune=true 顺便清理（收进来一周没用过的、45 天没用过的）。\n注意：清理是真删文件，但只删很久没用的；库里会留 index.json 记账。",
  source: "工具说明书",
});

const cards = loadKb("data").entries.filter((e) => e.category === "工具");
console.log(`工具卡现在 ${cards.length} 张`);
console.log(`sticker_send 卡: ${cards.some((c) => c.title.includes("sticker_send"))}`);
console.log(`sticker_library 卡: ${cards.some((c) => c.title.includes("sticker_library"))}`);
