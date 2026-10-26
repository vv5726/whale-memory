# 怎么搬到别的宿主上

这套东西不是一个能 `npm install` 就用的库（虽然可以包成那样），它是**一套模式**：一个 SQLite 库 + 几个纯函数 + 一个循环。

所以移植的关键不是搬代码，是搞清**哪一部分必须留、哪一部分可以扔**。

---

## 必须留（记忆内核，约 3000 行）

| 文件 | 作用 | 能不能改 |
|---|---|---|
| `types.ts` | 数据结构 | 可以加字段 |
| `db.ts` | 建表、迁移、行映射 | 保留 |
| `extract.ts` | 对话 → 事 | 核心，谨慎 |
| `affect.ts` | 情绪打分 | 可以换模型/词典 |
| `anchors.ts` | 锚点与关系网 | 核心 |
| `compress.ts` | 分层下沉 | 核心 |
| `sleep.ts` | 六个步骤的编排 | 核心 |
| `recall.ts` | 检索 | 核心 |
| `cold.ts` | 冷存储 | 可选但建议留 |
| `util.ts` `text.ts` | 工具 | 保留 |

## 可以扔（环境外壳）

```
bot/onebot.ts     NapCat / OneBot 11 —— 你用什么聊天软件就换什么
bot/service.ts    把记忆接到聊天上 —— 换成你的宿主胶水
tools/phone.ts    adb 手机控制 —— 跟记忆无关
tools/bili.ts     B站 —— 跟记忆无关
bot/autonomy.ts   自主活动 —— 想要「它会自己动」才需要
```

## 三个接入点

想把它接到你自己的 AI 上，只需要实现三件事：

### 1. 写：把对话存进去

```ts
import { ingestTurns } from "./src/extract.ts";
ingestTurns(db, [{ day: "2026-10-25", role: "user", text: "……", speakerId: "用户ID" }]);
```

**注意**：`speakerId` 在多用户场景必须传，否则检索时分不清「谁的妈妈」。

### 2. 睡：定期整理

```ts
import { sleepAsync } from "./src/sleep.ts";
await sleepAsync(db, memoryConfig, { nowTs: Date.now() }, llmAdapter);
```

建议节奏（我们用的）：

- 聊完停 3 分钟 → 整理最新那批
- 每天凌晨 3–5 点 → 整天重读一遍（能读出跨段的因果）

**坑**：如果你自己做抽取缓存，**一定要按内容做键，不要按日期**。我们按天做键，结果 329 条对话被跳过、记忆一条没涨。

### 3. 读：拼进提示词

```ts
import { recall } from "./src/recall.ts";
const r = recall(db, memoryConfig, userMessage, { sessionId, speakerId });
const system = `${persona}\n\n【记忆】\n${r.contextBlock}`;
```

`r.contextBlock` 就是可以直接塞进提示词的那一段，通常 200–500 token。

---

## 提示词怎么写（这一半比代码重要）

记忆检索得再准，**提示词写错，模型照样编**。我们踩过的：

### 必须写：弱记忆怎么处理

```
【注意】上面没有和这句话真正相关的记忆。
你确实不知道，就用「不记得了」这类话回应。
不许编：金额、日期、人名、地点、结论——这四类一个都不许给。
```

### 必须写：分清对方在问什么

```
- 问具体往事 → 有就答，没有就说不记得
- 给你下指令 → 回答「记下了」，绝对不要回「我不记得」
- 问你的看法 → 这是要你判断，别说不知道
- 问「我刚才说了什么」→ 看上面这段对话，不在记忆库里
```

**这四条缺一条就会出问题**：最典型的症状是「你问它一个规矩，它回你不记得」。

### 必须写：不许吹牛

```
不要说「你的事我基本都记着」这类话。
```

### 可选：让它自己管记忆

如果你的模型支持工具调用，给它三个工具，它会活得像一个真的在记事的人：

```
memory_save(text)   我自己判断这件事值得记
memory_tidy()       我自己决定整理一次
memory_stats()      我看看自己记住了什么
```

我们加了之后，它的原话是：

> 「什么值得存」是你在定还是我在定？我想试试自己判断一次。

---

## 数据库怎么迁移

`db.ts` 用的是**加列式迁移**（`ensureColumn`），不是版本号跳变。所以：

- 旧库打开时会自动补新列，不用写迁移脚本
- 加字段永远是 `ensureColumn(db, "events", "新列", "TEXT NOT NULL DEFAULT ''")`

**坑**：`ensureColumn` 要放在 `CREATE TABLE` 之后执行。我们一开始把它放进 schema 字符串里，报 `no such column`。

## 成本

- 一条普通回复：输入 ~6000 token（其中工具描述占 3900），输出 ~200
- 一次睡眠（一天 300 条对话）：约 0.01–0.02 元
- 一次读视频（7000 字字幕）：约 0.02 元

如果只做记忆、不挂工具，输入能降到 2000 左右。

## 零依赖是怎么做到的

- `node:sqlite` —— Node 22.5+ 内置，不用 `better-sqlite3`
- 原生跑 `.ts` —— Node 22.6+ 的类型剥离，不用编译
- 没有 ORM、没有向量库、没有分词库（用的是 bigram + IDF）

**好处**：`git clone` 下来直接 `node src/demo.ts` 就能跑。
**代价**：不能用 npm 上的东西。真要更准的检索，自己加 embedding 也行——`recall.ts` 里留了位置。
