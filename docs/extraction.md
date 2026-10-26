# 记忆抽取：完整逻辑

写给要改它的人（也写给以后的自己）。

---

## 一、什么时候抽

```
用户说一句话
  → 存进 turns 表（processed = 0）
  → 沉默 3 分钟（idleSleepMinutes）
  → 触发一次 sleep（整理）
  → 睡眠里第一步就是「抽取」
```

其他触发点：

| 触发 | 来源 | 备注 |
|---|---|---|
| 沉默 3 分钟 | `bot.ts` 的空闲计时 | 日常 |
| 凌晨 3–5 点 | `dailySleepWindow` | 整日整理 |
| 它自己调 `memory_tidy` | 工具 | 它想整理就整理 |
| 手动 `tools/force-reextract.ts` | 我 | ⚠️ 会炸重复，慎用 |

---

## 二、抽取的输入

```ts
extractDayWithLlm(
  db, cfg, index, adapter,
  day,                      // 'YYYY-MM-DD'
  turns,                    // 当天还没处理的对话
  names = { user, assistant }
)
```

`turns` 每条形如：

```json
{ "id": "t_xxx", "role": "user" | "assistant", "text": "原话", "speakerId": "你自己" }
```

**按天分批，每批最多 60 轮**（`CHUNK = 60`）。为什么：一次塞 700 轮，模型只会挑最显眼的十几件事。

---

## 三、缓存（第一个坑）

```js
const EXTRACT_VERSION = "v3-myview";
const sig = `${EXTRACT_VERSION}:${轮数}:${总字数}:${前两轮前24字}:${后两轮前24字}`;
// 命中 → 直接用 llm_extractions 里的旧 raw，不再调模型
```

**改了抽取规则（加字段、改问法）必须动 `EXTRACT_VERSION`。**

否则：提示词改了、解析改了，但缓存命中，模型一次都不跑 —— 表现就是「明明改了却毫无变化」。
这个坑踩过一次，代价是排查了两小时。

---

## 四、提示词里要什么

模型必须返回这个结构（只输出 JSON）：

```json
{"events":[{
  "title":"不超过24字，带关键检索词",
  "detail":"对话原文",
  "cause":"前因或 null",
  "effect":"后果或 null",
  "core":"最能唤起画面的细节",
  "affect":{"valence":-1到1,"arousal":0到1,"tags":["情绪词"],"summary":"一句话感受"},
  "key_facts":["多年后仍要准确复述的词"],
  "anchors":[{"name":"实体名","kind":"person|place|thing|event|theme","confidence":0到1}],
  "my_view":"我当时怎么想的（没有就 null）",
  "promise":{"isPromised":true或false,"what":"约定内容或null"}
}]}
```

关键规则（`规则：` 那段）：

1. **一条记忆 = 一件事**（不是一句话）
2. `turns: [起, 止]` —— 这件事从第几轮说到第几轮
3. 人称一律写 QQ 号，不写「主人」「对方」
4. **每条都要带 `my_view`**：我当时觉得重要吗、同意吗、打算怎么办、想说没说的
   - 要有具体判断，不要「我认为这很重要」这种废话
   - 没有真实想法就填 `null`，**别硬编**

---

## 五、解析（第二个坑）

```ts
parseAndValidate(raw, fallbackAffectOn)
```

对每个事件：

```
title      取 24 字；不足 2 字 → 丢弃（rejected + 1）
detail     = 原文 + 「〔我当时想：${my_view}〕」
             直接把 my_view 拼进正文，不单独存字段
             「主人」→ 替换成真实名字
anchors    去重、限制数量
```

**`my_view` 拼进 detail 是刻意的**：检索、导出、注入全都只读 detail，
单独开一列反而要多改七八处，还容易漏。

**坑**：这段解析曾被「按行号改文件」冲掉过 ——
提示词在要 `my_view`，模型也老实返回了，但解析没读，直接扔掉。
表现：看起来什么都对，就是没有判断。**改这个文件后必须真跑一次验证。**

---

## 六、写库（第三个坑）

### 去重三道闸

```
① 同一天 + 同一个标题  → 直接跳过（重放）
② findReinforceTarget  → 认定「同一件事」→ 不新建，走加强
③ 否则                 → insertEventRow 新建
```

加强时：

```js
mentions += 1
strength  = min(3, 1 + (mentions - 1) * 0.25)
detail    = 新的有「我当时想」而旧的没有 ? 新的
          : 新文本更长                  ? 新的
          :                               旧的
```

**第三个坑**：原来只有「更长才覆盖」。
新版带着判断但整体比旧版短 → 被判成「不如旧的」→ 判断永远进不去。
所以加了第一条：**新版有判断、旧版没有 → 一律换新版**。

### INSERT 的列和参数必须逐个数

```sql
INSERT INTO events(id, day, ts, period_label, tier, stage, title, detail, cause, effect,
  core_fragment, affect_valence, affect_arousal, affect_tags, affect_summary,
  pinned, pin_expires_at, key_facts, strength, mentions, derived_from, context_kinds,
  kind, size_tokens, archived, source_turn_id, created_at, updated_at, speaker_id)
```

**28 列 / 28 个 `?` / 28 个参数。** 少一个，最后一个参数会绑成 NULL，
而 `speaker_id` 是 `NOT NULL` → 整次整理失败。

再加一个字段时：`tools/audit-inserts.ts` 会把四处 INSERT 的
「列数 / 占位符 / 参数个数」全打出来对一遍。

---

## 七、补写说话人（第四个坑）

抽取出来的记忆默认没有 `speaker_id`（模型不知道谁说的）。整理时补：

```sql
-- ① 有来源对话的，直接取
UPDATE events
SET speaker_id = COALESCE((SELECT t.speaker_id FROM turns t WHERE t.id = events.source_turn_id), '')
WHERE speaker_id = '' AND EXISTS (SELECT 1 FROM turns t2 WHERE t2.id = events.source_turn_id)

-- ② 没有来源对话的，只在「当天只有一个说话人」时才敢补
UPDATE events
SET speaker_id = COALESCE((SELECT t.speaker_id FROM turns t WHERE t.day = events.day ...), '')
WHERE speaker_id = '' AND (当天不同说话人数 = 1)
```

**坑**：子查询查不到时返回 `NULL`，而列是 `NOT NULL` → 整个 tidy 报错。
**必须 `COALESCE(..., '')`。** 这个坑今天让 tidy 挂了一整天。

---

## 八、睡醒之后

```
抽取 → 归属 → 压缩 → 固化 → 算心情
```

抽取只负责「变成事件」，后面几层管下沉和遗忘。

---

## 九、她改不了这个

`src/llm/extract.ts` 里的提示词是**代码**。
她能改的只有 `self_write`（自我描述）。

所以当她说「我把抽取提示词改了」——那是她在改一个碰不到的东西。
**要改抽取，只有改代码这一条路。**

---

## 十、验证清单

改完抽取，依次跑：

```bash
node tools/audit-inserts.ts     # 四处 INSERT 列/占位符/参数对齐
node tools/diag-extract.ts      # 逐层：提示词 → 模型返回 → 解析 → 带 my_view
node tools/verify-tidy.ts       # 造两轮对话 → 真跑 tidy → 清数据
node tools/selftest-full.ts     # 全量自测
```

**四个都绿了才算改完。** 只看其中一个是今天反复踩坑的原因。
