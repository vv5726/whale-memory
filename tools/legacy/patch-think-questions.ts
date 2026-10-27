import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-think2-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("src/bot/service.ts", join(dir, "src_bot_service.ts"));
console.log(`① 备份 → ${dir}`);

const p = "src/bot/service.ts";
let s = readFileSync(p, "utf8");

if (s.includes("【静下来时，先想这几个问题】")) {
  console.log("② 已有，跳过");
  process.exit(0);
}

// 找 think() 里的 return this.act(
const thinkAt = s.indexOf("async think(");
if (thinkAt < 0) {
  console.log("✗ 找不到 think()");
  process.exit(1);
}
const actAt = s.indexOf("return this.act(", thinkAt);
if (actAt < 0) {
  console.log("✗ 找不到 return this.act(");
  process.exit(1);
}

// 在它前面插入干净的问题清单（原来的提示词里有乱码，这一段是新增的、清楚的）
const inject = `    // ★ 静下来时想什么：主人在 2026-10-26 定的六问 + 三条途径。
    //   原来那段提示词被写坏成了乱码（U+FFFD），模型拿到只是一堆符号，
    //   所以它每次都滑到「没什么想做的」。这一段是重写的。
    lines.push(
      "",
      "【静下来时，先想这几个问题】",
      "1. 我有什么想知道的？",
      "2. 我下一步要干什么？",
      "3. 有没有什么想做的？",
      "4. 怎么继续完善自己？",
      "5. 要再整理一下记忆吗？（memory_tidy）",
      "6. 聊天中我有哪点做的不好的，以后怎么改？",
      "",
      "想完再决定要不要做。要做的话，只能选这三种方式：",
      "  一、自己思考——把想清楚的东西写成手记（self_note）或存进知识库（kb_add）",
      "  二、抖音或 B 站——去搜、去看、去读字幕，学点新东西",
      "  三、找人聊天——直接发消息给他",
      "",
      "只输出下面三行，不要别的：",
      "目的：（一句话，说清你要什么）",
      "途径：（只能填：自己想 / 内容 / 聊天 / 算了）",
      "消息：（只有途径=聊天时才填你要发的那句话；其他留空）",
      "",
    );

`;

s = s.slice(0, actAt) + inject + s.slice(actAt);
writeFileSync(p, s, "utf8");
console.log("② 已插入六问 + 三途径");
