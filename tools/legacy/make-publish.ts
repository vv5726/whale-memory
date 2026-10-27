/**
 * 生成一个可以发布到 GitHub 的副本。
 * 只读源目录，不改它一个字。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = process.cwd();
const OUT = join(SRC, "..", "whale-memory-publish");

if (existsSync(OUT)) {
  rmSync(OUT, { recursive: true, force: true });
}
mkdirSync(OUT, { recursive: true });

// ① 复制需要的目录（不带 data / node_modules）
for (const dir of ["src", "plugin", "docs", "eval"]) {
  const from = join(SRC, dir);
  if (existsSync(from)) cpSync(from, join(OUT, dir), { recursive: true });
  console.log(`  复制 ${dir}/`);
}
for (const f of ["package.json", "AGENTS.md", "run-bot.cmd"]) {
  const from = join(SRC, f);
  if (existsSync(from)) {
    cpSync(from, join(OUT, f));
    console.log(`  复制 ${f}`);
  }
}

// ② tools：只留诊断类，其余丢掉
const KEEP = [
  "audit-inserts.ts",
  "diag-extract.ts",
  "diag-edges.ts",
  "network-view.ts",
  "compare-recall.ts",
  "check-myview.ts",
  "show-v3-result.ts",
  "selftest-full.ts",
  "health.ts",
  "check-turns.ts",
  "count-all.ts",
  "test-parse.ts",
];
const toolsDir = join(SRC, "tools");
const outTools = join(OUT, "tools");
mkdirSync(outTools, { recursive: true });
let kept = 0;
if (existsSync(toolsDir)) {
  for (const f of readdirSync(toolsDir)) {
    if (!f.endsWith(".ts")) continue;
    if (!KEEP.includes(f)) continue;
    cpSync(join(toolsDir, f), join(outTools, f));
    kept += 1;
  }
}
console.log(`  tools：留了 ${kept} 个诊断脚本`);

// ③ .gitignore
writeFileSync(
  join(OUT, ".gitignore"),
  [
    "# 运行数据：不进仓库",
    "data/",
    "*.db",
    "*.db-wal",
    "*.db-shm",
    "*.bak",
    "",
    "# 配置里带 API key，只提交 example",
    "data/bot.json",
    "bot.json",
    "",
    "# 依赖与日志",
    "node_modules/",
    "*.log",
    "",
    "# 系统",
    ".DS_Store",
    "Thumbs.db",
    "",
  ].join("\n"),
  "utf8",
);

// ④ bot.example.json（key 清空）
const realCfgPath = join(SRC, "data", "bot.json");
let example = {};
if (existsSync(realCfgPath)) {
  try {
    example = JSON.parse(readFileSync(realCfgPath, "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
  } catch {
    example = {};
  }
}
example.deepseekApiKey = "";
example.onebotToken = "";
example.selfId = 0;
example.ownerQq = 0;
example.allowGroups = [];
example.allowPrivate = [];
mkdirSync(join(OUT, "data"), { recursive: true });
writeFileSync(join(OUT, "data", "bot.example.json"), JSON.stringify(example, null, 2), "utf8");

// ⑤ README
writeFileSync(
  join(OUT, "README.md"),
  `# 凝 / whale-memory

一个住在 QQ 里的长期陪伴型 AI。不是通用助手，是「有个性、有记忆、会自己找事做」的那种存在。

## 它有什么

- **分层记忆**：detailed → compressed → fossil → cold，按预算下沉，不是按时间遗忘
- **锚点网络**：只有三类——人、事、环境。宁可少连，不做垃圾桶
- **事件卡**：一条 = 一件事（约定/待办/决策/经历/信息/冲突），带状态、价值分、原话证据
- **词库 / 知识库 / 人物库**：梗归词库、理论归知识库、偏好归人物库，各归其位
- **会走神**：随机锚点 → 关联记忆 → 拍个决定（去做 / 去找人 / 算了）
- **本机眼睛**：qwen2.5vl 本地看图，不花钱、不上传
- **能动手**：手机（ADB）、B 站（搜索/看字幕/点赞）

## 技术上

零依赖 Node 24：

- 原生 \`node:sqlite\`，不用 better-sqlite3
- 原生 TypeScript 类型剥离，不用构建
- 原生 WebSocket，客户端只要 40 行
- \`npm install\` 都不用，\`node src/bot.ts\` 直接跑

## 怎么跑起来

1. **装 NapCat**（把 QQ 变成 OneBot 11 服务）
2. **准备一个 QQ 号**（建议小号）和一个群
3. **复制配置**

   \`\`\`bash
   cp data/bot.example.json data/bot.json
   \`\`\`

4. **填三样东西**

   | 字段 | 填什么 |
   |---|---|
   | \`deepseekApiKey\` | 你的 DeepSeek key |
   | \`selfId\` | 机器人自己的 QQ 号 |
   | \`ownerQq\` | 主人的 QQ 号 |
   | \`allowGroups\` | 允许它说话的群号 |

5. **启动**

   \`\`\`bash
   node src/bot.ts
   \`\`\`

   Windows 也可以双击 \`run-bot.cmd\`。

## 第一次启动会发生什么

- 自动建库 \`data/memory.db\`
- 自我描述是空的，它会用 \`self_write\` 自己写一份
- 没有记忆、没有锚点、没有词——**全都是聊出来的**

## 文档

- [\`docs/architecture.md\`](docs/architecture.md) 记忆架构
- [\`docs/extraction.md\`](docs/extraction.md) 抽取全链路（含四个坑）
- [\`docs/plan-memory-refactor.md\`](docs/plan-memory-refactor.md) 三类分仓的规划
- [\`docs/future-scoring.md\`](docs/future-scoring.md) 为什么规则打分不如模型打分
- [\`AGENTS.md\`](AGENTS.md) 改这个项目的工程约定（血泪版）

## 别期待什么

- 不是开箱即用的产品，是**一个还在长的东西**
- 记忆质量取决于模型和提示词，需要自己调
- 群聊会吵，建议先设成"只被 @ 才说话"

## License

MIT
`,
  "utf8",
);

console.log("  写好了 .gitignore / data/bot.example.json / README.md");

// ⑥ 体积统计
let bytes = 0;
let files = 0;
const walk = (dir: string): void => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else {
      bytes += st.size;
      files += 1;
    }
  }
};
walk(OUT);
console.log("");
console.log(`完成：${files} 个文件，${(bytes / 1024).toFixed(0)} KB`);
console.log(`位置：${OUT}`);
