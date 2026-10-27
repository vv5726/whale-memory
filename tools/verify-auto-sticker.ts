/**
 * 验证「她会不会主动发表情包」：
 *  ① 情绪词 → query 的映射
 *  ② 兜底发送：命中情绪 + force 时真发，且发送钩子拿到存在的文件
 *  ③ 不命中情绪 / 库里没货 / 没发送通道时，安静地不发
 *  ④ 每小时上限仍然生效（不会因为兜底绕过限流）
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { autoStickerAfterReply, autoStickerQuery } from "../src/bot/auto-sticker.ts";
import { loadIndex, stickerDir } from "../src/stickers.ts";

const tmpDir = "data/tmp-autosticker";
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  console.log("=== ① 情绪词映射 ===");
  const cases: Array<[string, string | null]> = [
    ["哈哈哈哈哈这也太搞笑了", "大肥鱼开心"],
    ["无语，真的服了", "大肥鱼疑惑"],
    ["呜呜我好委屈", "大肥鱼难过"],
    ["气死我了", "大肥鱼生气"],
    ["贴贴你", "大肥鱼喜欢"],
    ["今天下午三点开会", null],
    ["好", null],
  ];
  for (const [text, want] of cases) {
    const got = autoStickerQuery(text);
    check(`「${text}」→ ${want ?? "不发"}`, got === want, got ?? "");
  }

  console.log("\n=== ② 命中就发 ===");
  // 造一个只有「大肥鱼开心」的图库
  const src = readdirSync("data/stickers").find((n) => n.endsWith(".jpg"));
  const dir = stickerDir(tmpDir);
  copyFileSync(join("data/stickers", src ?? ""), join(dir, "test.jpg"));
  writeFileSync(
    join(dir, "index.json"),
    JSON.stringify({
      items: [
        {
          hash: "test",
          file: join(dir, "test.jpg"),
          query: "大肥鱼开心",
          title: "大肥鱼·开心",
          source: "",
          addedAt: Date.now(),
          usedCount: 0,
          lastUsedAt: 0,
          width: 100,
          height: 100,
        },
      ],
    }),
    "utf8",
  );

  const sent: string[] = [];
  const r = await autoStickerAfterReply(tmpDir, "哈哈哈哈哈", { force: true, send: (p) => void sent.push(p) });
  check("命中时发出去了", r.sent && sent.length === 1, r.reason);
  check("发的是真实存在的文件", sent[0] ? loadIndex(tmpDir).items.some((x) => x.file === sent[0]) : false);

  console.log("\n=== ③ 不该发的时候安静 ===");
  const r2 = await autoStickerAfterReply(tmpDir, "今天下午三点开会", { force: true, send: () => {} });
  check("没情绪词就不发", r2.sent === false && r2.reason.includes("不适合"));
  const r3 = await autoStickerAfterReply(tmpDir, "好委屈啊", { force: true, send: () => {} });
  check("库里有别的情绪、没这张就不发", r3.sent === false, r3.reason);

  console.log("\n=== ④ 限流仍然有效 ===");
  // 同一张有 30 分钟冷却，所以要放 8 张不同图，才能测到「每小时 6 张」那道闸
  const items = [];
  for (let i = 1; i <= 8; i++) {
    const f = join(dir, `t${i}.jpg`);
    copyFileSync(join("data/stickers", src ?? ""), f);
    items.push({
      hash: `t${i}`,
      file: f,
      query: "大肥鱼开心",
      title: `大肥鱼·开心${i}`,
      source: "",
      addedAt: Date.now(),
      usedCount: 0,
      lastUsedAt: 0,
      width: 100,
      height: 100,
    });
  }
  writeFileSync(join(dir, "index.json"), JSON.stringify({ items }, null, 1), "utf8");
  let count = 0;
  for (let i = 0; i < 8; i++) {
    const rr = await autoStickerAfterReply(tmpDir, "哈哈哈哈哈", { force: true, send: () => void count++ });
    if (!rr.sent) {
      console.log(`  第 ${i + 1} 次被拦：${rr.reason}`);
      break;
    }
  }
  check("连发 8 次只放行 6 张（每小时上限）", count === 6, `实际发了 ${count} 张`);
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
