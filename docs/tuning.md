# 调参手册：预算在哪，效果在哪

> 这份文档只回答一个问题：**想让某件事变好（或者变便宜），该动哪个数字。**
> 每个数字都给：默认值、它管什么、调大会怎样、调小会怎样、在哪改、要不要重启。
>
> 对应 `SCHEMA_VERSION = 2`　·　2026-10-27

---

## 0. 先分清三个钱包

大部分人调坏，是因为把这三个混成了一个：

| 钱包 | 单位 | 谁在管 | 花光了会怎样 |
|---|---|---|---|
| **注意力** | token | `contextBudgetTokens` | 不会花光——它是"记忆库能被塞进提示词的总量"，超了旧记忆就下沉 |
| **钱** | 元 | `dailyBudgetYuan` + 两个单价 | 当天不许再调模型（回话直接说"转不动"） |
| **机会** | 次 | 每日额度（视频 / 写操作 / 自主轮次） | 今天不能再干那件事，聊天照常 |

最容易混的三个数：

```
contextBudgetTokens  = 记忆库"能记多少"     ← 影响记性，不影响单次请求大小
factTopK / 1,200     = 每次请求"塞多少进去" ← 影响单次请求大小，地位见 §2
dailyBudgetYuan      = 一天最多烧多少钱     ← 影响她说多少话、走多少次神
```

**把 `contextBudgetTokens` 调大，单次请求不会变贵。** 每次塞进去的记忆有 `factTopK` 条、1,200 token 两道闸，跟库多大无关。这是最常见的误解。

---

## 1. 收到一条消息

| 数字 | 在哪 | 默认 | 含义 |
|---|---|---|---|
| 去重窗口 | `src/bot/onebot.ts` | **90 秒** | 同一条 `message_id` 在这个窗口内只认一次。**别调小**——OneBot 会重复投递 |
| `HISTORY_LIMIT` | `src/bot/service.ts` | **50 条** | 每个会话在内存里留多少轮 |
| `slice(-30)` | `src/bot/persona.ts` | **30 条** | 其中多少条真的发给模型。**调大＝更连贯，但每轮都更贵**（历史是每轮重发的） |
| `groupReplyMode` | `bot.json` | `mention` | `mention` 只有 @ 才回／`all` 每条都回 |
| `recordGroupChat` | `bot.json` | `false` | 群聊要不要记进 `turns`。不开就谈不上"记得群里发生过什么" |
| `strangerReply` | `bot.json` | `""` | 陌生人私聊回什么；空＝不回 |

**踩过的坑**：去重窗口调到 5 秒，OneBot 重投的那条会被当新消息 → 她自问自答。

---

## 2. 想起来（召回）

这是"效果"的主战场。分四层：**装多少 → 怎么算分 → 怎么挑 → 什么时候算没想起**。

### 2.1 装多少

| 数字 | 在哪 | 默认 | 含义 |
|---|---|---|---|
| `factTopK` | `src/config.ts` | **5 条** | 一次最多注入几条"确定相关"的记忆 |
| `MEMORY_BLOCK_TOKEN_CAP` | `src/recall.ts` | **1,200 token** | 整个记忆块的硬上限，超了从最低分开始丢 |
| 单条正文 | `src/recall.ts` | **180 字** | 单条最多占多少字 |

**调大 `factTopK`** → 一次想起更多事，但很快撞上 1,200 的上限（到那时调它没用，得先调上限）
**调大 1,200** → 上下文变重，每轮都贵；**调小** → 更省，但"她好像忘了我刚说的"

### 2.2 怎么算分（全部权重都在 `src/config.ts`）

```
证据 = 锚点激活 × 边权重（求和）
     + 联想加成（强证据 × 0.35，同人同 120 天内）
     + 字面命中（IDF 加权的二字组）
     + FTS 命中（+0.6）

raw   = (证据 + 情绪加成 + 新鲜度加成)
        × 同人系数 × 质量分 × 标题命中

总分  = (raw × 层可及性 + 钉住加成) × (1 + 0.25 × (strength − 1))
```

| 权重 | 默认 | 管什么 | 调大 → |
|---|---|---|---|
| `recencyWeight` | **0.1** | 新鲜度加成（`0.1 × 半衰 × 0.5`）。故意压得很低——人对日期本来就不敏感 | 最近的事更容易冒出来，但会挤掉旧的重要事 |
| `arousalBonus` | **0.35** | 情绪加成（`0.35 × arousal`）。只用来加分，**不能凭空把无关旧事顶上来** | 情绪强的事更抢眼 |
| 新鲜度半衰 | **30 天** | 普通记忆 30 天掉一半鲜活度；**钉住的 / 带关键事实的不衰减** | 旧事忘得快 |
| `SIBLING_WINDOW_DAYS` | **120 天** | 同一个人、同一段日子的记忆顺带浮上来（×0.35） | 联想更远 |
| 同人系数 | **1.25 / 1.0 / 0.75** | 当前说话人的事加分，别人的事减分 | 共享记忆下防止"你妈的病捞到朋友的妈" |
| 标题命中 | **×2.6** | 标题里出现关键词＝这条就在讲这件事 | 压过"正文顺带提了一句"的半截话 |
| 层可及性 | **1.0 / 0.75 / 0.35** | 清晰层 1.0、压缩层 0.75、化石层 0.35 | 见 §3 |
| `pinnedBonus` | **0.6** | 钉住加成，且**按证据强度放大**（钉住是"想起来更牢"，不是"永远置顶"） | 钉住的更强势 |
| `hopDecay` / `maxHops` | **[1.0, 0.5, 0.25] / 2** | 激活扩散最多跳 2 跳，每跳衰减 | 联想链更远，也更容易跑题 |

**质量分 `qualityOf`**（`src/recall.ts`，压噪音用的乘法惩罚）：

| 情况 | 系数 |
|---|---|
| 带关键事实（金额/日期/结论） | ×(1 + 12%/个，最多 +40%) |
| 正文 < 10 字（半截话） | ×0.55 |
| 正文 < 25 字 | ×0.8 |
| 正文 > 180 字（多半整段对话倒进来了） | ×0.75 |
| 标题以标点开头 | ×0.5 |
| 标题是「X 是什么 / 什么意思」 | ×0.75 |
| 正文里有「；后来」（两件事被压成一条） | ×0.55 |
| 标题 > 30 字 | ×0.85 |

### 2.3 怎么挑

| 数字 | 默认 | 含义 |
|---|---|---|
| `probabilisticPool` | **8** | 情绪通道的采样池：在分数最高的 8 条里按概率抽一条 |
| `temperatureBase` | **0.6** | 采样温度基数 |
| `temperatureArousalGain` | **1.2** | 每单位 arousal 往上加多少温度 |

所以实际温度是 `0.6 + 1.2 × arousal`——**越激动，想起的东西越随机**。同一个问题不会每次得到同样的回忆，这是设计。

### 2.4 什么时候算"没想起"

| 数字 | 默认 | 含义 |
|---|---|---|
| 初筛 | `证据 < 0.05` 直接丢 | 没有任何线索指向的记忆不参与排序 |
| 证据闸门 | `min(0.25, max(0.06, 最高分×0.3))` | 只看**证据**，不看总分 |
| `wakeThreshold` | **0.45** | 最高分低于它就判定"这次没想起"，提示词会写"你确实不知道"，并且**禁止编数字** |

**为什么闸门看证据不看总分**：久远的记忆因为层可及性低而排不上前面，但只要线索确实指向它，就不能当成"没想起来"直接丢掉。

---

## 3. 记多少（分层下沉）

| 数字 | 在哪 | 默认 | 含义 |
|---|---|---|---|
| `contextBudgetTokens` | `bot.json` | **200,000**（代码默认 1,000,000） | 能被载入上下文的总量 |
| `detailedQuota` | `src/config.ts` | **0.3** | 清晰层拿 30% |
| `compressedQuota` | `src/config.ts` | **0.5** | 压缩层拿 50% |
| `FOSSIL_MAX_EVENTS` | `src/compress.ts` | **1,000,000 条** | 化石层**不占 token**，按条数封顶 |
| 降级粒度 | —— | 一条一条 | 从最旧、最弱的开始，直到装得下 |

**换算**（按实测单条 token）：

```
detailed   ≈ 118 token/条  → 1,000,000 × 30% ÷ 118 ≈ 2,540 条
compressed ≈  52 token/条  → 1,000,000 × 50% ÷  52 ≈ 9,600 条
fossil     不占预算，按条数 100 万（≈ 磁盘 0.9 GB，够三四年）
```

⚠️ 注意这行：`bot.json` 的 200,000 会**覆盖**代码里的 1,000,000。两处不一样，看 `bot.json` 那个。

- **调大** → 记得更久；副作用：睡眠变慢、召回候选变多（但单次请求不变贵）
- **调小** → 旧记忆更快下沉；调太小会出现"这周的事都进压缩层"，说话变模糊
- **单向**：只会从清晰往压缩、往化石走，不会因为体积波动来回升降

**别改回去的一条**：化石层一旦吃 token 预算，第三层永远卡在 20 万（≈5,000 条 / 7 天），等于让"想不起来的东西"挤"要用的东西"的额度。

---

## 4. 情绪（会改语气，不只是排序）

| 数字 | 在哪 | 默认 | 含义 |
|---|---|---|---|
| 心境半衰 | `src/recall.ts` | **10 小时** | 每 10 小时淡一半；淡到很浅就归"平静" |
| `felt_now` 公式 | `src/recall.ts` | `0.6×当时 + 0.15×心境` | 想起一件事时"现在想起来"的感受 |
| 刷新频率 | `src/recall.ts` | **1 小时** | 同一件事最多一小时刷一次 |
| 情绪词表 | `data/affect-words.json` | 不存在 | 她自己能写；`disable` 可关默认词典 |

**半衰调大** → 情绪挂得久（像人，但容易"昨天的气今天还在"）
**半衰调小** → 散得快（安全，但留不住"那次真的很难过"）

---

## 5. 睡觉（整理）

| 数字 | 在哪 | 默认 | 含义 |
|---|---|---|---|
| `idleSleepMinutes` | `bot.json` | **3** | 聊完 3 分钟整理一次。**主力触发** |
| `idleSleepHours` | `bot.json` | 12（**0 = 关**） | 长闲置再收一遍 |
| `sleepForceThreshold` | `bot.json` | 50（**0 = 关**） | 攒够 50 条未处理对话强制整理 |
| `dailySleepWindow` | `bot.json` | `[3,5]` | 每天 3–5 点整日整理 |
| `announceSleep` | `bot.json` | `true` | 强制整理时在群里说一句 |
| `CHUNK` | `src/sleep.ts` | **60 轮/段** | 一次喂模型多少轮。太大→模型挑不动，太小→一天跑很多次 |
| `llmTimeoutMs` | `src/config.ts` | **120 秒** | 抽取单次超时 |

- **调大 `idleSleepMinutes`** → 少跑几次、省抽取的钱，但记忆滞后
- **调小** → 更及时，抽取调用更多（每次都是一整天的量，不便宜）
- 睡眠是**一个事务、可中断、可重跑**：崩了下次接着来，不会写坏

---

## 6. 自己活着（走神 / 自主活动）

| 数字 | 在哪 | 默认 | 含义 |
|---|---|---|---|
| `autonomyMinutes` | `bot.json` | 20 | 每 N 分钟一轮自主活动 |
| `autonomyHours` | `bot.json` | `[9,24]` | 活动时段，支持跨午夜 `[22,6]` |
| `autonomyIdleMinutes` | `bot.json` | 8 | 刚有人说话就跳过，别打断 |
| `autonomyDailyRounds` | `bot.json` | 24（**0 = 不限**） | 每天最多几轮 |
| `thinkEnabled` | `bot.json` | true | 走神总开关 |
| `thinkChance` | `bot.json` / tuning | 0.55 / 0.85 | 到点后掷中的概率 |
| `thinkGapMin` / `thinkGapMax` | tuning | 1.5 / 3.5 分钟 | 两次走神的间隔（**随机**，避免像闹钟） |
| `thinkIdleSeconds` | tuning | 30 秒 | 他说话后安静多久才允许走神 |
| `thinkSettleSeconds` | tuning | 90 秒 | 刚干完活缓多久再走神 |
| `phonePlayChance` | `bot.json` | 0.35 | 这一轮先去玩手机而不是刷 B 站 |

**掷骰子是纯本地随机，一个 token 都不花**——只有掷中了才走模型。这是省钱的核心设计。

---

## 7. 回话（语气与成本）

| 数字 | 在哪 | 默认 | 范围 | 含义 |
|---|---|---|---|---|
| `replyTemperature` | tuning | 0.9 | 0–1.5 | 说话温度。**>1.2 开始复读、自问自答** |
| `extractTemperature` | tuning / config | 0.3 | 0–1 | 抽取记忆的温度。0 会写成模板 |
| `groupSpeakThreshold` | tuning | 0.6 | 0–1 | ⚠️ **没接线**：只存不用。群里回不回只由 `groupReplyMode` + 白名单决定（见 §1） |
| `replyRounds` | tuning | 8 | 1–60 | 回话最多调几轮工具。**每轮重发全量 → 轮数是平方级花钱** |
| `actRounds` | tuning | 6 | 1–60 | 自主活动时最多几轮工具 |
| `HARD_ROUND_CAP` | `toolchat.ts` | 999 | 代码 | 不写死轮数时的硬顶，兜底死循环 |
| 单次超时 | `bot/service.ts` | **90 秒** | 代码 | 一轮模型调用最多等多久 |
| `v3MinValue` | tuning | 3 | 0–10 | 价值分低于这个数就不记。**调高＝记得更少更准** |
| `v3MaxEvents` | tuning | 8 | 1–30 | 一批最多记几条 |
| `planDoneMemoryValue` | tuning | 6 | 0–10 | 计划做完写成记忆时给几分 |
| `silentCheckMinutes` / `silentGiveUpMinutes` | tuning | 3 / 60 | 1–120 / 5–1440 | ⚠️ **没接线**：只存不用 |

⚠️ **tuning.json 每个值都有钳制范围**（第五列）。超出范围会被**静默钳住**、不报错——这是"我改了怎么没反应"的第一大原因。

---

## 8. 钱与额度

| 数字 | 在哪 | 默认 | 含义 |
|---|---|---|---|
| `dailyBudgetYuan` | `bot.json` | 5（**0 = 不限**） | 每天最多花多少元 |
| `costInputPerMTok` | `bot.json` | 2 | 每百万输入 token 多少钱 |
| `costOutputPerMTok` | `bot.json` | 8 | 每百万输出 token 多少钱 |
| 缓存价 | `src/cost.ts` | 输入的 **1/10** | 只用于"真实账单"；**卡预算仍按保守价** |
| `biliDailyVideoQuota` | `bot.json` | 0（**0 = 不限**） | 每天最多看几个视频 |
| `biliDailyWriteLimit` | `bot.json` | 0（**0 = 不限**） | 每天最多几次写操作 |
| `proactiveDailyLimit` | `bot.json` | 0（**0 = 不限**） | 每天最多主动找几次 |

**这个项目里 `0` 几乎总是"不限"，不是"禁止"。** 代码里专门为此留过一条注释：以前把 0 算成"还剩 0 个"，结果阅读员一整天只翻标题、一条字幕没读。

**为什么要额度**：不是省钱，是**制造稀缺**——能无限刷的模型会把额度当空气，什么都看、什么都记，最后什么也没记住。

---

## 9. 关系网（边）与钉住

| 数字 | 在哪 | 默认 | 含义 |
|---|---|---|---|
| 边半衰 | `src/anchors.ts` | **热 15 / 温 3 / 冷 2 天** | 按两端锚点挂的记忆在哪一层决定 |
| 温边上限 | `src/anchors.ts` | **20,000** | 超了删到 50% |
| 冷边上限 | `src/anchors.ts` | **2,000** | 同上 |
| 热转温削 | `src/anchors.ts` | **25%** | 刚变温那批只留四分之一 |
| `salienceDecay` | `src/config.ts` | **0.98** | 锚点自身每次睡眠衰减 2% |
| `identityMergeThreshold` | `src/config.ts` | **0.99** | 两个锚点重合度到多少才并成一个 |
| `pinnedLimit` | `src/config.ts` | **50 条** | 全库最多钉几条 |
| `pinnedDailyLimit` | `src/config.ts` | **3 条/天** | 每天最多新钉几条 |
| `pinnedTtlDays` | `src/config.ts` | **400 天** | 普通钉住的有效期 |
| 永久钉住 | `pinPermanentPatterns` | 密码/手机号/生日… | 这些不设有效期 |

**调大半衰期** → 联想更持久，但边越滚越大（现在 13,188 条 same-day 边是库里最大的表）
**调小** → 网络更干净，但"想起一件事顺带想起旁边的"会变少

---

## 10. 全量总表

### A. `data/bot.json`（33 项）

| 字段 | 默认 | 一句话 |
|---|---|---|
| `onebotWs` | `ws://127.0.0.1:3001` | OneBot 地址 |
| `accessToken` | `""` | OneBot 鉴权 |
| `selfId` | `0` | 机器人 QQ 号 |
| `allowPrivate` / `allowGroups` | `[]` | 白名单：**不在里面不回** |
| `groupReplyMode` | `mention` | `mention` 只在 @ 时回／`all` 全回 |
| `recordGroupChat` | `false` | 群聊是否落 `turns` |
| `strangerReply` | `""` | 陌生人私聊回什么；空＝不回 |
| `provider` | `ollama` | `ollama` / `deepseek` |
| `ollamaBaseUrl` / `ollamaModel` | `127.0.0.1:11434` / `qwen3:8b` | 本地后端 |
| `deepseekBaseUrl` / `deepseekModel` | `api.deepseek.com/v1` / `deepseek-chat` | 远端后端 |
| `deepseekApiKey` | `""` | **绝不外传** |
| `dailyBudgetYuan` | 5 | 每天上限（0 = 不限） |
| `costInputPerMTok` / `costOutputPerMTok` | 2 / 8 | 单价，供应商调价要跟 |
| `sharedMemory` | `true` | 群和私聊共用一库；false＝每人 `users/<qq>.db` |
| `memoryDb` | `data/qq-memory.db` | 库路径 |
| `contextBudgetTokens` | 200,000 | 记忆总量预算（覆盖代码里的 1,000,000） |
| `useLlmExtractor` | `true` | false＝纯启发式（省钱，但记不出情绪和因果） |
| `extractV3` | `false` | 用 v3 事件卡抽取（etype/status/evidence/价值分） |
| `toolsEnabled` | `true` | 工具总开关 |
| `adbPath` / `screenshotDir` | `C:\platform-tools\adb.exe` / `data/screenshots` | 手机 |
| `biliSessdata` / `biliJct` | `""` | B 站 cookie |
| `biliDailyVideoQuota` / `biliDailyWriteLimit` | 0 / 0 | 每日额度（0 = 不限） |
| `approvalRequired` | `false` | B 站写操作要不要人工批准 |
| `logPort` | 3211 | 日志网页端口（0 = 不开） |
| `idleSleepMinutes` | 3 | 聊完几分钟整理 |
| `idleSleepHours` | 12 | 长闲置再整理（0 = 关） |
| `sleepForceThreshold` | 50 | 攒够多少条强制整理（0 = 关） |
| `dailySleepWindow` | `[3,5]` | 整日整理时段 |
| `dailySleepHour` | `null` | 另一种写法：每天某点 |
| `announceSleep` | `true` | 强制整理时说一句 |
| `autonomyEnabled` | `true` | 自主活动总开关 |
| `autonomyMinutes` | 20 | 每 N 分钟一轮 |
| `autonomyHours` | `[9,24]` | 活动时段（支持跨午夜） |
| `autonomyIdleMinutes` | 8 | 刚有人说话就跳过 |
| `autonomyDailyRounds` | 24 | 每天轮次（0 = 不限） |
| `thinkEnabled` | `true` | 走神总开关 |
| `thinkChance` | 0.55 | 掷中概率 |
| `thinkIdleSeconds` / `thinkSettleSeconds` | 30 / 90 | 安静多久 / 缓多久 |
| `proactiveEnabled` | `true` | 主动开口（**`startSpeaking()` 是空实现，开了也不吭声**） |
| `proactiveDailyLimit` | 0 | 每天几次（0 = 不限） |
| `proactiveIdleMinutes` | 45 | 多久没聊才考虑开口 |
| `phonePlayEnabled` / `phonePlayChance` | true / 0.35 | 玩手机 |

### B. `data/tuning.json`（15 项，她自己也能改）

见 §7 的表，全部带钳制范围。

### C. `src/config.ts` 的 `DEFAULT_CONFIG`（代码默认，没有配置文件）

| 字段 | 默认 | 一句话 |
|---|---|---|
| `contextBudgetTokens` | 1,000,000 | 被 `bot.json` 覆盖 |
| `detailedQuota` / `compressedQuota` | 0.3 / 0.5 | 三层比例 |
| `recencyWeight` | 0.1 | 新鲜度权重 |
| `hopDecay` / `maxHops` | `[1.0,0.5,0.25]` / 2 | 激活扩散 |
| `tierAccessibility` | 1.0 / 0.75 / 0.35 | 层可及性 |
| `factTopK` | 5 | 注入几条 |
| `probabilisticPool` | 8 | 情绪采样池 |
| `temperatureBase` / `temperatureArousalGain` | 0.6 / 1.2 | 采样温度 |
| `pinnedBonus` / `arousalBonus` | 0.6 / 0.35 | 两个加成 |
| `wakeThreshold` | 0.45 | 低于它判"没想起" |
| `autoWakeContent` | false | 是否直接读底片正文（费 token） |
| `pinnedLimit` / `pinnedDailyLimit` / `pinnedTtlDays` | 50 / 3 / 400 | 钉住的三道闸 |
| `salienceDecay` | 0.98 | 锚点每次睡眠衰减 |
| `identityMergeThreshold` | 0.99 | 锚点合并阈值 |
| `bindInferredAnchors` | true | 推断锚点也挂上（弱权重） |
| `extractor` | heuristic | 被 `useLlmExtractor` 覆盖 |
| `llmTimeoutMs` | 120,000 | 抽取超时 |
| `freezeExtractions` | true | 模型抽取结果落库即冻结（保证睡眠幂等） |

### D. 写死在别处的数字

| 数字 | 文件 | 值 |
|---|---|---|
| 记忆块上限 / 单条上限 | `recall.ts` | 1,200 token / 180 字 |
| 激活 top / 门槛 | `recall.ts` | 6（放宽 12）/ 0.15 |
| 新鲜度半衰 / 联想窗口 | `recall.ts` | 30 天 / 120 天 |
| 心境半衰 | `recall.ts` | 10 小时 |
| 化石条数上限 | `compress.ts` | 1,000,000 |
| 边半衰 / 上限 / 削 | `anchors.ts` | 15·3·2 天 / 2万·2千 / 25% |
| 去重窗口 | `onebot.ts` | 90 秒 |
| 硬顶轮数 / 超时 | `toolchat.ts` | 999 / 90 秒 |
| 历史条数 | `service.ts` / `persona.ts` | 50 / 30 |
| 抽取分段 | `sleep.ts` | 60 轮 |

---

## 11. 按目标调

**想省钱（从上到下，见效快）**
1. `dailyBudgetYuan` 调到你真愿意花的上限
2. 核对 `costInputPerMTok` / `costOutputPerMTok` 跟供应商一致（写错就是假账）
3. `replyRounds` 8 → 5（工具环是平方级花钱）
4. `thinkChance` 0.85 → 0.4；`autonomyMinutes` 6 → 20
5. `v3MaxEvents` 8 → 5（少记一点，抽取便宜）

**想记得更久**
1. `contextBudgetTokens` 200k → 1M
2. `idleSleepMinutes` 调小（更及时）
3. `v3MinValue` 3 → 2（少丢东西）

**想更准、别胡编**
1. `v3MinValue` 3 → 5
2. `v3MaxEvents` 8 → 4
3. `factTopK` 5 → 3（少塞几条，少给模型编的素材）
4. 动 `data/extract-rules.md`，让抽取更严

**想她少说话**
1. `groupReplyMode` → `mention`（**这条真管用**；`groupSpeakThreshold` 没接线）
2. `proactiveEnabled` → false
3. 把群从 `allowGroups` 里去掉 = 群里彻底不吭声（只记群号，不建库）

**想她更活泼**
1. `thinkChance` ↑、`thinkGapMaxMinutes` ↓
2. `autonomyMinutes` ↓、`autonomyHours` 拉长
3. `replyTemperature` 0.9 → 1.05（**别过 1.2**）

---

## 12. 四个翻车配方（都是真事）

1. **把 0 当"禁止"**：`biliDailyVideoQuota: 0` 是"不限"，不是"不许看"。写反了，阅读员一整天只翻标题、一条字幕不读。
2. **化石层吃 token 预算**：第三层永远卡在 20 万（≈7 天），等于让"想不起来的东西"挤"要用的东西"。**已修，别改回去。**
3. **单条正文不封顶**：一条 400 字，五条就顶掉整个记忆块，她开始答非所问。180 字是踩出来的。
4. **温度调太高**：`replyTemperature > 1.2` 会复读、自问自答。0.9–1.0 是实测舒适区。

---

## 13. 改完怎么验

```
□ 这个数字要重启吗？
    bot.json          → 要（启动时读一次）
    tuning.json       → 不用（每次调用重读）
    data/*.md（人格/规则/走神提问）→ 不用（每次开口重读）
    src/config.ts 等代码 → 要
□ node tools/check-encoding.ts       # 中文没被写坏
□ node tools/verify-handle.ts        # 真跑一次回话
□ node tools/verify-edge-logic.ts    # 动过边就验
□ node tools/verify-fossil-budget.ts # 动过分层就验
□ 看 data/logs/bot.log 或 http://127.0.0.1:3211
□ 问她一句 memory_stats，看三层条数有没有按预期动
```

**只看"import 成功"不算验证。** 这个项目上已经因为这件事栽过四次。

---

## 14. 三个"改了但没用"的高发原因

| 现象 | 原因 |
|---|---|
| 改了 tuning 没反应 | ① 超出钳制范围被静默钳住（§7 第五列）② 那个旋钮**本来就没接线**（`groupSpeakThreshold`、`silentCheckMinutes`、`silentGiveUpMinutes`） |
| 改了 bot.json 没反应 | 忘了重启（启动时只读一次） |
| 调大预算但记性没变好 | 撞上 `factTopK` / 1,200 token 这两道闸（§2.1），库再大也只塞这么多 |
