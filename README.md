# 凝 / whale-memory

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

- 原生 `node:sqlite`，不用 better-sqlite3
- 原生 TypeScript 类型剥离，不用构建
- 原生 WebSocket，客户端只要 40 行
- `npm install` 都不用，`node src/bot.ts` 直接跑

## 怎么跑起来

1. **装 NapCat**（把 QQ 变成 OneBot 11 服务）
2. **准备一个 QQ 号**（建议小号）和一个群
3. **复制配置**

   ```bash
   cp data/bot.example.json data/bot.json
   ```

4. **填三样东西**

   | 字段 | 填什么 |
   |---|---|
   | `deepseekApiKey` | 你的 DeepSeek key |
   | `selfId` | 机器人自己的 QQ 号 |
   | `ownerQq` | 主人的 QQ 号 |
   | `allowGroups` | 允许它说话的群号 |

5. **启动**

   ```bash
   node src/bot.ts
   ```

   Windows 也可以双击 `run-bot.cmd`。

## 第一次启动会发生什么

- 自动建库 `data/memory.db`
- 自我描述是空的，它会用 `self_write` 自己写一份
- 没有记忆、没有锚点、没有词——**全都是聊出来的**

## 文档

- [`docs/architecture.md`](docs/architecture.md) 记忆架构
- [`docs/extraction.md`](docs/extraction.md) 抽取全链路（含四个坑）
- [`docs/plan-memory-refactor.md`](docs/plan-memory-refactor.md) 三类分仓的规划
- [`docs/future-scoring.md`](docs/future-scoring.md) 为什么规则打分不如模型打分
- [`AGENTS.md`](AGENTS.md) 改这个项目的工程约定（血泪版）

## 别期待什么

- 不是开箱即用的产品，是**一个还在长的东西**
- 记忆质量取决于模型和提示词，需要自己调
- 群聊会吵，建议先设成"只被 @ 才说话"

## License

MIT
