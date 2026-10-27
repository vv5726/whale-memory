/**
 * 预下载表情包（命令行版）。
 *
 * 用法：
 *   node tools/prefetch-stickers.ts                     # 默认 26 个关键词，每个 3 张
 *   node tools/prefetch-stickers.ts --per 4 --max 80    # 每个词 4 张、总共最多 80 张
 *   node tools/prefetch-stickers.ts --queries "猫猫,贴贴,无语"
 */
import { prefetchStickers, stickerStats } from "../src/stickers.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const perQuery = Number(flag("per", "3"));
const maxTotal = Number(flag("max", "60"));
const custom = flag("queries", "");
const queries = custom ? custom.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined;

console.log(`预下载：${queries ? queries.length + " 个自定义关键词" : "默认关键词"}，每个 ${perQuery} 张，上限 ${maxTotal} 张`);
const t0 = Date.now();
const stats = await prefetchStickers("data", { queries, perQuery, maxTotal });
const after = stickerStats("data");
console.log(
  [
    `新增 ${stats.added} 张（搜了 ${stats.queries} 个词，跳过 ${stats.skipped} 条不合格的）`,
    `耗时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒，新增约 ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`,
    `库存现在 ${after.count} 张（用过 ${after.used} 张），共 ${(after.bytes / 1024 / 1024).toFixed(1)} MB`,
  ].join("\n"),
);
