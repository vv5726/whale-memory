# 项目结构与架构（交给新会话看的）

> 这份文档是**自包含**的：看完它就能接手，不需要之前任何对话的记忆。
> 最后更新：2026-10-28（功能冻结，见下）。

> ## ⚠️ 项目状态：功能冻结（2026-10-28）
>
> 跑通了，但**不再继续迭代**。作者已经看到这套做法的局限：
>
> - **最硬的一条**：对话里 66 个工具定义 = **16k token**，占第一轮 24k 的 **2/3**，而且每轮重发。
>   想省只能砍工具，可聊天随时可能用到任何一个——这个矛盾在这套架构里解不开。
> - 工具结果不折叠（取回率 >10% 就白干，没敢上）；提示词越写越长越稀释；
>   多定时器靠 flag 互斥，出过「起两个实例抢同一个连接」的事故。
>
> 接下来换新架构。这个仓库留作**思路参考**：值得抄的是分层记忆、锚点图、走神四问、队列批处理；
> **不建议直接拿去跑**——还有 7 个已知未解决的 bug。
>
> 完整清单见 [`STATUS.md`](STATUS.md)。

---

## 一、这是什么

`C:\Users\Administrator\Documents\deepseek-harness\default-workspace\whale-memory`

一个 QQ 机器人「凝」：**分层记忆 + 锚点关系网 + 走神（自主行为）+ 工具环 + 能改自己**。
零依赖，Node 24 直接跑 TypeScript（type stripping），数据库用内置 `node:sqlite`。

- 接入：OneBot 11，WS `ws://127.0.0.1:3001`（实测用 **SnowLuma**；NapCat / LLOneBot 同理，只要它讲 OneBot 11）
- 模型：DeepSeek `deepseek-chat`（可切 Ollama）
- 规模：`src` 约 70 个文件、`tools` 332 个脚本（多数是历史一次性脚本）、74 个工具
- 数据：`data/memory.db`（记忆）、`data/knowledge.json`（知识库）、`data/*.md`（她的人格与规则）

## 二、怎么跑

```powershell
# 启动（后台常驻，日志进 data/logs/）
run-bot.cmd

# 或前台调试
node src/bot.ts

# 首次配置：把 data/bot.example.json 复制成 data/bot.json，填 key / QQ / 群号
```

必填：`deepseekApiKey`、`accessToken`（OneBot 的）、`selfId`（机器人 QQ）、`allowPrivate` / `allowGroups`。

停止 / 重启（改完代码必须重启才生效）：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*src\bot.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process -FilePath "$env:ComSpec" -ArgumentList '/c','run-bot.cmd' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden
```

## 三、目录结构

```
src/
  bot.ts                 入口：连 OneBot、装日志、起路由与自主循环
  bot/
    onebot.ts            OneBot WS 协议、收发、去重、群名册
    router.ts            按会话分流（共享记忆/独立记忆）、群白名单
    service.ts           ★核心：拼提示词、调模型、工具循环、历史、记账（1100 行）
    persona.ts           提示词拼装（人格/场景/记忆/历史/工具清单）
    autonomy.ts          走神（**唯一的自主循环**）+ 自主活动（定时器已停用）+ 主动开口（已停用）
    config.ts            bot.json 读取与类型
    logview.ts           把 console 落成 bot.log + 3211 端口日志网页
  llm/
    adapter.ts           DeepSeek / Ollama 适配
    toolchat.ts          工具调用循环（★这是"钱"的主要开销）
    extract.ts v3        LLM 抽取：对话 → 事件
  tools/                 74 个工具，一个文件一组（index.ts 汇总注册）
  ---- 记忆核心 ----
  db.ts                 表结构（events / anchors / edges / turns / cold_archive / mood_state）
  recall.ts             ★召回：激活扩散 + 打分 + 渲染成提示词里的记忆块
  extract.ts            抽取管线（清洗、切句、入库、挂锚点、同日连边）
  compress.ts           三层压缩（预算驱动，单向降级）
  cold.ts               冷存储（原文 + cold:// 地址）
  anchors.ts            锚点与边（建边、衰减、上限）
  sleep.ts              ★"睡觉"：抽取→合并→压缩→情绪→衰减边，一个事务跑完
  affect.ts             情绪词典（她的词表叠加在上面）
  plans.ts / notes.ts / impressions.ts / knowledge.ts   计划、笔记、印象、知识库
  person-graph.ts / people.ts                            人物与别名
  ---- 其他 ----
  cost.ts 额度与记账   quota.ts 计数   tuning.ts 可调参数   cqcode.ts QQ 消息段
  stickers.ts 表情包   vision.ts 看图   group-policy.ts 群策略
```

`data/` 下：

| 文件 | 是什么 | 归谁 |
|---|---|---|
| `memory.db` | 全部记忆、对话、锚点、边 | 数据 |
| `persona.md` | 人格（2191 字） | **她自己能改** |
| `speech-rules.md` | 说话规矩（655 字） | **她自己能改** |
| `extract-rules.md` | 抽取规则（418 字） | **她自己能改** |
| `think-prompt.md` | 走神时问自己什么 | **她自己能改** |
| `tuning.json` | 温度、轮次、门槛等 12 项 | **她自己能改** |
| `affect-words.json` | 情绪词表（默认不存在） | **她自己能写** |
| `knowledge.json` | 知识库（242 KB） | 数据 |
| `bot.json` | 配置（**含密钥，绝不外传**） | 人 |
| `journal/*.md` | 手记（按天） | 她的 |

## 四、一条消息的完整链路

```
① onebot.ts      收到事件 → sessionId = group:<群号> / private:<QQ>，speaker_id = 谁，去重（90s 内同一 message_id 只认一次）
② router.ts      白名单/群策略 → serviceFor(userId)
③ service.handle
   a. 清洗文本（CQ 码、图片描述）
   b. 落库 turns（role/speaker_id/session_id/day）
   c. recallQuery = 最近两句 + 当前句
   d. recall()  → 记忆块（≤1200 token）
   e. buildChatPrompt() → 系统提示（人格/场景/记忆/工具/50 条历史）+ 当前句
   f. runChatWithTools() → 工具循环（每轮重发全量，钱在这里烧）
   g. 防幻觉守卫（回答里的具体事实必须在记忆里）
   h. 落库 assistant + 更新内存历史
④ 回复：分口气发（bubbles），带名字前缀
```

**另有一条后台线**：`sleep.ts`（聊完 3 分钟 / 每天 3–5 点）做抽取和压缩；`autonomy.ts` 每 1.5–3.5 分钟走一次神——**走神现在是唯一的自主循环**：去 B 站看、动手做事，都由它自己决定（自主活动的定时器已关）。

## 五、记忆是怎么组织的

### 三层（预算驱动，单向降级）

| 层 | 保留 | 每条 | 预算 | 能装 | 能撑 |
|---|---|---|---|---|---|
| detailed | 标题+正文+因果+感受+事实 | 113 token | 300,000 | 2,648 条 | 3.7 天 |
| compressed | 丢正文 | 55 token | 500,000 | 9,035 条 | 12.6 天 |
| fossil | 丢因果，只剩感受+片段 | 40 token | **按条数 100 万** | 100 万条 | ≈3.8 年 |
| cold_archive | **原文全文**（永久，不进上下文） | 0.3 KB | 磁盘 | — | — |

预算总开关：`bot.json → contextBudgetTokens = 1,000,000`（第一层 30%、第二层 50%；**fossil 不占 token 预算**，按条数封顶）。

### 锚点 + 关系网

- 锚点：人（QQ）、事、场景、话题。一条记忆挂 3–5 个，**从任何角度都能找到它**
- 边：同一天出现的锚点两两连（`same-day`）
- 边的管理（2026-10-27 定）：
  - 半衰期：**热 15 天 / 温 3 天 / 冷 2 天**（按两端锚点挂的记忆在哪一层）
  - 上限：温边超 20,000、冷边超 2,000 → 砍到 50%；热边不设上限
  - 热转温那一刻，新变温的边只留 **25%**

### 情绪

- 每条记忆带 valence/arousal/tags/summary
- `felt_now_*`：每次被想起时更新（当年 0.6 + 当前心境 0.15）
- `mood_state`：心境，10 小时衰减一半；由睡眠时按近期记忆重算
- 她可以 `feel` 工具直接改心境、改某条记忆的情绪

## 六、自主行为（现状）

| 行为 | 触发 | 现状 |
|---|---|---|
| **走神** | 安静 30 秒、85% 概率、两轮隔 1.5–3.5 分 | **唯一的自主循环**（2026-10-27 起）。四条途径都有落点，见下 |
| **自主活动** | 原本每 6 分钟一轮 | ⚠️ **定时器已关**（`bot.json` 的 `autonomyEnabled: false`），代码没删。主体（阅读员看 B 站）已挪成走神的「内容」途径 |
| **主动开口** | 45 分钟没聊 | ⚠️ **已停用**：`startSpeaking()` 第一行就是 `return () => {}` |

走神的输出被解析成「目的 / 途径 / 消息 / 给」四行（`src/intent.ts`），途径 = `做 / 内容 / 聊天 / 算了`。

**四条途径在 2026-10-27 之前只有「聊天」真的发生什么**：「内容」和「做」只往手记写一行，`intent.action` 全项目没人读。现在：

| 途径 | 谁执行 | 上限 |
|---|---|---|
| 聊天 | `onSpeak(msg, to)` → `deliver()` 真发出去 | — |
| 内容 | `Reading.run()`：派阅读员看一轮 B 站 → 简报 → 存知识库/写手记 | 阅读员 6 轮 + 学习 4 轮 |
| 做 | **只记账**：`queue_add` 写进 `data/todo-queue.json`，攒够了批处理一起做 | 每批最多 10 条 / 批处理 6 轮 |
| 算了 | 什么都不做 | — |

**2026-10-28 又改了一次**：以前「做」是当场动手——一天 188 次，每次一整轮模型请求。

- 走神现在**只拿 3 个工具**（`queue_add` / `self_note` / `memory_recent`）。
  实测工具定义从 **26,870 字符 → 1,189 字符**，每次走神省约 17k token。
- 「做」写进队列，由 `BatchRunner` 在**攒够 10 条 / 深任务 3 条 / 最老的等满 30 分钟**时批处理一次。
- 批处理**拿不到手机，也拿不到 `bili_subtitle`**（字幕太长会撑爆上下文）；
  `heavy` 类（要读 B 站/长文件）留给阅读员单独跑，不进批处理。

两个执行器都和走神本身一样**不碰手机**（手机工具只在聊天里可用）。

## 七、工具系统（74 个）

| 组 | 数量 | 例子 |
|---|---|---|
| 手机（ADB） | 11 | `phone_screenshot` `phone_dump_ui` `phone_tap_text` |
| B 站 | 9 | `bili_search` `bili_subtitle` `bili_hot` |
| 记忆 | 18 | `memory_save` `memory_recent` `memory_pin` `feel` |
| 计划 | 7 | `plan_add` `plan_due` `plan_done` |
| 表情包 | 5 | `sticker_send` `sticker_library` |
| **改自己** | 12 | `persona` `speech` `tune_reply` `think` `extract` `self_write` |
| 知识库 | 4 | `kb_add` `kb_search` `kb_list` `kb_link` |
| 其它 | 8 | `say_to` `get_time` `see_image` `source` `group_members` |

工具注册：`src/tools/index.ts → buildTools()`；参数校验与回执在 `src/tools/registry.ts`。

## 八、她能动自己什么地方（这是项目最特别的部分）

| 东西 | 工具 | 文件 | 生效 |
|---|---|---|---|
| 人格 | `persona` | `data/persona.md` | 下一句 |
| 说话规矩 | `speech` | `data/speech-rules.md` | 下一句 |
| 抽取规则 | `extract` | `data/extract-rules.md` | 下次睡眠 |
| 走神提问 | `data_file` | `data/think-prompt.md` | 下次走神 |
| 参数 | `tune_reply` | `data/tuning.json` | 下一次调用 |
| 情绪词表 | `data_file` | `data/affect-words.json` | 立刻重载 |
| 对自己认识 | `self_write` | `data/self.md` | 下一句 |

## 九、当前真实状态（2026-10-27）

```
记忆 2,143 条（detailed 553 / compressed 1,590 / fossil 0）
边   12,292 条（热 1,785 / 温 9,269 / 冷 1,102 / co-occur 136）
底片 1,600 条原文（16.7 万字）
锚点 473 个 / 对话 2,874 条 / 库 7.3 MB
进料 ~714 条/天
今天：走神 27 次、开口 1 次、自主活动 13 次、工具调用 45 次
成本：今天约 1.5 元 / 上限 50 元
```

今天改过的东西（别重复做）：

1. OneBot 重复投递去重（90 秒窗口）
2. 会话历史按 `session_id` 过滤；群历史从"按人"改成"按群"；旧的 80 条群会话已回填
3. `say_to` 的发送器接上（router 透传 `deliverText`）；发送改成等回执（`sendChecked`）
4. 记忆块加 1,200 token 上限、单条正文 180 字；压缩预算 200k → 1M；fossil 脱离 token 预算
5. 边的三档半衰期 + 层上限 + 热转温削 25%
6. v3 抽取开始产出情绪（模型给优先，词典兜底）
7. `feel` 工具（改心境 / 改某条记忆的情绪）
8. 情绪词表 `data/affect-words.json`（合并默认词典，`disable` 可关默认词）
9. `intent.ts` 途径解析放宽（认"找人聊天""聊天（私聊）"等）；chat 但没写消息不再静默丢失
10. `docs/phone.md`（玩手机说明，已加进 `source` 白名单）
11. **走神不再带手机工具**：`think()` 传 `toolFilter`（`service.ts` 的 `noPhoneTools`），
    `runChatWithTools` 按名字过滤 schema，提示词里的【工具】那行也跟着过滤。
    聊天和自主活动**照旧**有手机（玩手机那条路要用）。验证：`node tools/verify-think-no-phone.ts`
12. **走神接上「内容」和「做」两个执行器**（`autonomy.ts` 的 `readOnce()` / `actOnce()`）：
    以前四条途径里只有「对话」会真的发生什么，「内容」「做」只写一行手记。
    现在「内容」派阅读员看一轮 B 站（原来自主活动的主体），「做」给 3 轮工具真的去做。
    同时 `autonomyEnabled: false`——定时器关掉，代码留着。
    验证：`node tools/verify-think-channels.ts`（换掉 fetch，两条路各跑一遍）

## 十、改代码的纪律（踩过的坑）

| 坑 | 规矩 |
|---|---|
| PowerShell 写含中文的源码会静默变 `?` | **用编辑工具改，不要用 PowerShell 写回**；改完跑 `node tools/check-encoding.ts` |
| 前台 `pwsh` 会 0xC0000142 | 所有命令用 `run_in_background` + 读 job 输出 |
| `import('./src/bot.ts')` 会**再起一个 bot** | 验证脚本绝不能 import bot.ts |
| `bot.log` 每小时整点被清空 | 跨天对比用手记 `data/journal/*.md` |
| 只看 "import 成功" 不算验证 | 必须真跑一次：`handle()` / `sleepNow()` / 真调工具 |
| 破坏性操作 | 先 `Copy-Item data/memory.db data/backup-<原因>-<时间>.db` |
| `edit` 报 "file has not been read" | 先 `read` 再 `edit` |

常用命令：

```powershell
node tools/check-encoding.ts          # 编码检查
node tools/verify-handle.ts           # 真跑一次 handle
node tools/verify-intent.ts           # 意图解析 19 个用例
node tools/verify-edge-logic.ts       # 边三档半衰期 + 上限
node tools/verify-fossil-budget.ts    # 化石层不吃 token 预算
node tools/verify-feel.ts             # 情绪工具
node tools/verify-phone-doc.ts        # 她能不能读到手机文档
```

## 十一、已知问题 / 待办

| 项 | 状态 |
|---|---|
| 主动开口（45 分钟）被 `return () => {}` 停用 | 待决定是否恢复 |
| 走神与自主活动抢同一个 `busy` 锁，走神常被"刚忙完"跳过 | **已解决**（2026-10-27）：自主活动定时器关掉，只剩走神一条路 |
| 第二层缺口：`same-day` 边仍是"当天锚点两两全连" | 已有限流方案未启用 |
| GitHub 公开准备（拆出记忆、密钥、290 个一次性脚本、LICENSE、README） | 未开始 |
| 日志每小时清空，不利于排查 | 未改 |
| `src/bot/service.fixed.ts`、`service.recover.ts` 是残留副本 | 未删 |
| `tools/` 里 332 个脚本，多数是一次性 patch/fix | **已处理**：275 个挪进 `tools/legacy/`，根下只留 verify / check / compare / bot-smoke |

## 十二、文档索引

| 文件 | 内容 |
|---|---|
| `docs/how-i-work.md` | 她自己的角度讲这套系统（给她的） |
| `docs/architecture-map.html` | 一张图看懂架构（分层 + 数据流；悬停卡片高亮连线）。同目录 `architecture-map.png` 是它的截图 |
| `docs/tuning.md` | **调参手册**：每个数字是什么意思、动哪里能省预算/改效果、哪些要重启 |
| `docs/architecture.md` | 记忆架构原始设计 |
| `docs/extraction.md` | 抽取规则说明 |
| `docs/phone.md` | 玩手机：接线、工具、边界 |
| `docs/HANDOFF.md` | 旧的交接（2026-10-26，讲当时修了哪些 bug） |
| `README.md` | 面向外部读者的介绍（讲记忆） |
