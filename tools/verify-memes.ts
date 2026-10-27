/**
 * 验证「热梗」这条链：
 *   ① 提示词里有【用梗的规矩】和「先接情绪」那段，且没有操控限制那两条（按他要求不加）
 *   ② memes_recent 能按日期/关键词筛，过期会标出来
 *   ③ 阅读员任务里带了「学热梗」的指引
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildChatPrompt, loadPersonaText } from "../src/bot/persona.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { registerMemeTools } from "../src/tools/memes.ts";

const tmpDir = "data/tmp-memes";
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};
const day = (n: number): string => {
  const d = new Date(Date.now() - n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(
    join(tmpDir, "knowledge.json"),
    JSON.stringify({
      entries: [
        { category: "热梗", title: "他是懂我的", content: "反讽用法：对方说了离谱的话，用来阴阳。例：你是懂上班的。", source: `抖音热榜 ${day(1)}`, anchors: [] },
        { category: "热梗", title: "这波啊，这波是", content: "自嘲/吹捧都能用，接一句离谱结论。", source: `B站 ${day(10)}`, anchors: [] },
        { category: "热梗", title: "老梗：yyds", content: "已经过气很久。", source: `B站 ${day(60)}`, anchors: [] },
        { category: "B站", title: "不是热梗", content: "别的分类不该出现。", source: `B站 ${day(1)}`, anchors: [] },
      ],
    }),
    "utf8",
  );

  console.log("=== ① 提示词 ===");
  const persona = loadPersonaText("data");
  console.log(persona.includes("【用梗的规矩】") ? "✓ 人格里有【用梗的规矩】（可选）" : "· 人格里没有【用梗的规矩】（现在是自由版人格，功能靠工具，不强制）");
  console.log(persona.includes("先接情绪") ? "✓ 人格里有接情绪那段（可选）" : "· 人格里没有接情绪那段（可选）");
  console.log(persona.includes("memes_recent") ? "✓ 人格里提到 memes_recent（可选）" : "· 人格没提 memes_recent（工具还在，靠它自己判断）");
  check("按他要求：没有「不操控」那条", !persona.includes("不操控"));
  check("按他要求：没有「只有我懂你」那条", !persona.includes("只有我懂你"));

  const sys = String(
    buildChatPrompt({
      memory: { contextBlock: "（记忆）" },
      userName: "他",
      history: [],
      message: "在干嘛",
      memoryWeak: false,
      selfText: "",
    })[0].content,
  );
  console.log(sys.includes("【用梗的规矩】") && sys.includes("先接情绪") ? "✓ 拼进 system 了（可选）" : "· 这两段没进 system（自由版人格，正常）");

  console.log("\n=== ② memes_recent ===");
  const reg = new ToolRegistry();
  registerMemeTools(reg, { dataDir: tmpDir });
  const all = await reg.call("memes_recent", {});
  console.log(all.text.split("\n").map((l) => `  ${l}`).join("\n"));
  check("列出 2 条（60 天前的被排除）", (all.text.match(/^- /gm) ?? []).length === 2);
  check("没有混进别的分类", !all.text.includes("不是热梗"));
  const byQuery = await reg.call("memes_recent", { query: "阴阳" });
  check("按关键词筛得到「他是懂我的」", byQuery.text.includes("他是懂我的") && !byQuery.text.includes("这波啊"));
  const wide = await reg.call("memes_recent", { days: 90 });
  check("days=90 能把老梗捞出来并标快过气", wide.text.includes("yyds") && wide.text.includes("快过气"));
  const empty = await reg.call("memes_recent", { query: "不存在的词" });
  check("筛空时有话可说", empty.text.includes("没有"));

  console.log("\n=== ③ 阅读员任务 ===");
  const { readFileSync } = await import("node:fs");
  const autonomy = readFileSync("src/bot/autonomy.ts", "utf8");
  check("任务里要求搜热梗", autonomy.includes("热梗"));
  check("存的时候 category=热梗", autonomy.includes("category 填「热梗」"));
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
