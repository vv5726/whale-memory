/**
 * 把 dsh-meme 插件内置的「大肥鱼」图库（24 张，19 种情绪）导进凝自己的表情包库。
 * 源：~/.dsh/profiles/desktop/node_modules/dsh-meme/memes/dafeiyu-001/memes/<情绪>/*.jpg
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { addStickerBytes, loadIndex, stickerStats } from "../src/stickers.ts";

const base = join(
  process.env.USERPROFILE ?? "C:/Users/Administrator",
  ".dsh/profiles/desktop/node_modules/dsh-meme/memes/dafeiyu-001/memes",
);

const EMOTION_CN: Record<string, string> = {
  angry: "生气",
  baka: "笨蛋",
  color: "好色",
  confused: "疑惑",
  cpu: "过载",
  daily: "日常",
  fool: "傻乎乎",
  givemoney: "给钱",
  happy: "开心",
  like: "喜欢",
  meow: "猫爪",
  morning: "早安",
  sad: "难过",
  see: "偷看",
  shy: "害羞",
  sigh: "叹气",
  sleep: "睡觉",
  surprised: "震惊",
  work: "加班",
};

if (!existsSync(base)) {
  console.log(`✗ 找不到 dsh-meme 图库：${base}`);
  process.exit(1);
}

const before = loadIndex("data").items.length;
let added = 0;
let skipped = 0;

for (const dir of readdirSync(base, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const emotion = dir.name;
  const cn = EMOTION_CN[emotion] ?? emotion;
  const dirPath = join(base, emotion);
  for (const file of readdirSync(dirPath)) {
    if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(file)) continue;
    const buf = readFileSync(join(dirPath, file));
    if (statSync(join(dirPath, file)).size === 0) continue;
    const got = addStickerBytes("data", buf, {
      query: `大肥鱼${cn}`,
      title: `大肥鱼·${cn}`,
      source: `dsh-meme:dafeiyu-001/${emotion}/${file}`,
    });
    if (got?.isNew) {
      added += 1;
      console.log(`  + ${cn}  ${(buf.length / 1024).toFixed(0)} KB`);
    } else {
      skipped += 1;
    }
  }
}

const after = stickerStats("data");
console.log(
  [
    "",
    `新增 ${added} 张（重复/不合格 ${skipped} 张）`,
    `库存 ${before} → ${after.count} 张，共 ${(after.bytes / 1024 / 1024).toFixed(1)} MB`,
  ].join("\n"),
);
