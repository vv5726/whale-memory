/**
 * 验证表情包链路：
 *  ① 解析搜狗页面（离线 fixture，不依赖网络）
 *  ② 真搜一次 + 真下载一张（网络失败就跳过，不判失败）
 *  ③ 库里挑图 / 同图冷却 / 每小时上限
 *  ④ sticker_send 工具把图交给发送钩子
 *  ⑤ 清理过期图
 *  ⑥ 人格里有【表情包】
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_PER_HOUR,
  downloadSticker,
  getSticker,
  loadIndex,
  markUsedByHash,
  parseSogouHtml,
  pickFromLibrary,
  pruneStickers,
  searchSogou,
  stickerDir,
  stickerStats,
} from "../src/stickers.ts";
import { registerStickerTools } from "../src/tools/stickers.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { buildChatPrompt, loadPersonaText } from "../src/bot/persona.ts";

const tmpDir = "data/tmp-stickers";
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  console.log("=== ① 解析搜狗页面（离线 fixture）===");
  const fixture = `<html><script>window.__INITIAL_STATE__ = ${JSON.stringify({
    searchList: {
      searchList: [
        { thumbUrl: "https://example.com/a.jpg", title: "猫猫无语", width: 300, height: 300, pic_porn_score: 0.001 },
        { thumbUrl: "https://example.com/b.jpg", title: "违规图", pic_porn_score: 0.9 },
      ],
    },
  })};</script></html>`;
  const parsed = parseSogouHtml(fixture);
  check("能从 __INITIAL_STATE__ 抠出列表", parsed.length === 2, `parsed=${parsed.length}`);
  check("能读到标题/尺寸", parsed[0]?.title === "猫猫无语" && parsed[0]?.width === 300);

  console.log("\n=== ② 真搜 + 真下载 ===");
  let file = "";
  let network = false;
  try {
    const items = await searchSogou("猫猫表情包", 5);
    network = items.length > 0;
    console.log(`  搜到 ${items.length} 条`);
    check("安全分过滤生效（没有高 porn 的）", items.every((x) => Number(x.pic_porn_score ?? 0) < 0.05));
    if (items[0]) {
      const got = await downloadSticker(tmpDir, items[0], "猫猫");
      const rec = got?.rec;
      check("下载并入库", !!rec && got?.isNew === true && existsSync(rec.file), rec ? `${(readFileSync(rec.file).length / 1024).toFixed(0)} KB` : "没下载到");
      check("扩展名是真图（jpg/png/gif/webp）", !!rec && /\.(jpg|png|gif|webp)$/.test(rec.file));
      file = rec?.file ?? "";
    }
  } catch (err) {
    console.log(`  ⚠ 网络不通，跳过真搜：${err instanceof Error ? err.message : err}`);
  }

  console.log("\n=== ③ 挑图 / 冷却 / 上限 ===");
  if (file) {
    const picked = pickFromLibrary(tmpDir, "猫猫");
    check("能从库里挑到", !!picked && picked.file === file);
    markUsedByHash(tmpDir, picked!.hash);
    const again = pickFromLibrary(tmpDir, "猫猫");
    check("同一张在冷却期内不会再被挑中", again === null);
  } else {
    console.log("  （没有下载到图，跳过挑图检查）");
  }

  // 6 张刚发过 → 第 7 次必须被拦
  const idx = loadIndex(tmpDir);
  const now = Date.now();
  while (idx.items.length < MAX_PER_HOUR) {
    idx.items.push({
      hash: `fake${idx.items.length}`,
      file: join(stickerDir(tmpDir), `fake${idx.items.length}.jpg`),
      query: "测试",
      title: "测试",
      source: "",
      addedAt: now,
      usedCount: 1,
      lastUsedAt: now,
      width: 100,
      height: 100,
    });
  }
  writeFileSync(join(stickerDir(tmpDir), "index.json"), JSON.stringify(idx, null, 1), "utf8");
  const blocked = await getSticker(tmpDir, { query: "猫猫", allowSearch: false });
  check(`每小时上限 ${MAX_PER_HOUR} 张会拒绝`, blocked.ok === false && blocked.text.includes("刷屏"), blocked.text.slice(0, 40));

  console.log("\n=== ④ sticker_send 工具 ===");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const sent: string[] = [];
  const reg = new ToolRegistry();
  registerStickerTools(reg, { dataDir: tmpDir, send: (p) => void sent.push(p) });
  const r = await reg.call("sticker_send", { query: network ? "猫猫" : "猫猫", text: "给你看个图" });
  if (network) {
    check("工具发图成功", r.ok === true, r.text.slice(0, 50));
    check("发送钩子拿到了存在的文件", sent.length === 1 && existsSync(sent[0]));
  } else {
    check("网络不通时给出人话而不是崩", r.ok === false && r.text.length > 0, r.text.slice(0, 50));
  }
  const lib = await reg.call("sticker_library", {});
  check("sticker_library 能报库存", /表情包库：\d+ 张/.test(lib.text), lib.text.split("\n")[0]);

  console.log("\n=== ⑤ 清理 ===");
  const oldFile = join(stickerDir(tmpDir), "old.jpg");
  writeFileSync(oldFile, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]));
  const idx2 = loadIndex(tmpDir);
  idx2.items.push({
    hash: "old",
    file: oldFile,
    query: "",
    title: "",
    source: "",
    addedAt: Date.now() - 60 * 86_400_000,
    usedCount: 1,
    lastUsedAt: Date.now() - 60 * 86_400_000,
    width: 1,
    height: 1,
  });
  writeFileSync(join(stickerDir(tmpDir), "index.json"), JSON.stringify(idx2, null, 1), "utf8");
  const removed = pruneStickers(tmpDir);
  check("过期图被清掉", removed >= 1 && !existsSync(oldFile), `removed=${removed}`);
  check("库存统计能看", stickerStats(tmpDir).count === loadIndex(tmpDir).items.length);

  console.log("\n=== ⑥ 人格 ===");
  const persona = loadPersonaText("data");
  console.log(persona.includes("【表情包】") ? "✓ 人格里有【表情包】（可选）" : "· 人格里没有【表情包】（自由版人格，工具还在）");
  console.log(persona.includes("sticker_send") ? "✓ 人格提到 sticker_send（可选）" : "· 人格没提 sticker_send（可选）");
  const sys = String(
    buildChatPrompt({ memory: { contextBlock: "（记忆）" }, userName: "他", history: [], message: "在干嘛", memoryWeak: false, selfText: "" })[0]
      .content,
  );
  console.log(sys.includes("【表情包】") ? "✓ 拼进 system 了（可选）" : "· 没拼进 system（正常）");
  check("代码那层底线还在", sys.includes("【底线（这一段改不了）】"));
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
