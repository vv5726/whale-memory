/**
 * 把「大肥鱼」GIF 合集（100 张，抖音上很火那个蓝色肥鱼）导进表情包库。
 * 来源：https://github.com/diwer/ai-biaoqingbao （非商业二创，自用）
 *
 * 用法：node tools/import-dafiyu.ts [--limit 100]
 */
import { addStickerBytes, loadIndex, stickerStats } from "../src/stickers.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--limit");
const limit = i >= 0 ? Number(args[i + 1]) : 100;

const BASE = "https://raw.githubusercontent.com/diwer/ai-biaoqingbao/master/stickers/512";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

const before = loadIndex("data").items.length;
let added = 0;
let skipped = 0;
let bytes = 0;

for (let n = 1; n <= limit; n++) {
  const name = String(n).padStart(3, "0") + ".gif";
  const url = `${BASE}/${name}`;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      console.log(`  ✗ ${name} HTTP ${res.status}`);
      skipped += 1;
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const got = addStickerBytes("data", buf, {
      query: "大肥鱼",
      title: `大肥鱼 ${n}`,
      source: `github:diwer/ai-biaoqingbao/${name}`,
    });
    if (got?.isNew) {
      added += 1;
      bytes += buf.length;
      if (added % 10 === 0) console.log(`  已导 ${added} 张…`);
    } else {
      skipped += 1;
    }
  } catch (err) {
    skipped += 1;
    console.log(`  ✗ ${name} ${err instanceof Error ? err.message : err}`);
  }
}

const after = stickerStats("data");
console.log(
  [
    "",
    `新增 ${added} 张（跳过 ${skipped} 张：重复/太大/下载失败）`,
    `本次约 ${(bytes / 1024 / 1024).toFixed(1)} MB`,
    `库存 ${before} → ${after.count} 张，共 ${(after.bytes / 1024 / 1024).toFixed(1)} MB`,
  ].join("\n"),
);
