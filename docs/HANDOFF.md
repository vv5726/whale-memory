# 交接（2026-10-26 下午）

给下一个会话的我：**先读完这一页，再动任何代码。**

## 一、这个项目是什么

`C:\Users\Administrator\Documents\deepseek-harness\default-workspace\whale-memory`
QQ 机器人「凝」：分层记忆 + 锚点网络 + 走神 + 工具环。零依赖 Node 24，`node src/bot.ts` 起。

## 二、刚修好的：读心（read-mind）最后一跳（2026-10-26 16:15 已验收）

```
✓ src/read-mind.ts            读心调用，实测输出正常
✓ src/bot/router.ts           收消息 → readMind → 挂到 evt.mind
✓ service.promptExtras(evt)   返回 { mind: {...} }（已验证）
✓ src/bot/persona.ts          现在真的渲染了【他这句话】/【我听完】
```

**当时为什么没渲染：** `tools/patch-readmind.ts` 的两个 anchor（`parts.push("【怎么说话】")`、
类型里的注释行）在 persona.ts 里**根本不存在**，`String.replace` 匹配不到就原样返回，
脚本还照样打印「③ persona 已加两段」。文件跟备份 SHA256 一模一样 —— 等于没改。
**教训：改完要打印运行时拼出来的东西，不能信脚本自己报的「成功」。**

**这次怎么修的：**

1. `src/bot/persona.ts` → `buildChatPrompt` 的入参加了 `mind?`，渲染那段放在
   `parts.push(现在跟你说话的是…)` **之前**（也就是 `parts.filter(...).join` 之前）
2. `src/bot/service.ts` line 506 → `(evt as {...} | undefined)?.mind ?? null`
   （原来是 `(evt as {...}).mind`，`promptExtras()` 无参调用时**直接 TypeError**，
   把 `act()` / 自主活动那条路整个打崩了——顺手一起修）
3. 验收脚本：`node tools/verify-mind-render.ts`（跑真的 `buildChatPrompt` + 真的
   `BotService.promptExtras` → spread，6+3 项断言，全部通过）

**注意：** 改完要重启 bot 才生效（见第六节）。重启前它跑的还是旧代码。

## 三、今天做完的事（别重复做）

- 记忆重构：锚点只剩 人 / 事 / 环境 三类；legacy 63 个已停用
- 人锚点合并：同一个人的多个名字合成一个
- 事件卡：243 条带 `etype/status/memory_value/evidence`
- 关系边：一对一行，每锚点上限 20 条
- 走神提示词重写：六问 + 三途径（做 / 内容 / 聊天）
- followUp 删除、speakUp 停用 → 主动说话只剩走神一条路
- 分段改成按它自己写的换行拆（不按句号）
- 图片段不再被丢掉（onebot extractText）
- 表情 id 认不出时不露数字、去重
- `src/bot.ts` 已整个重写（中文正常，日志可读）
- 词库可挂锚点；学词必须说清是谁说的（`resolveSaidBy`）
- 发布副本：`../whale-memory-publish`（119 文件，无密钥）

## 三之二、16:22 这一轮修的两件（已验收、已重启生效）

**① 「同一个表情被算两次」（他以为对方连发两遍）**

真凶不在解析层，在**取历史的顺序**：
`handle()` 先把当前这句 `ingestTurns` 写进 turns 表，**然后**才 `historyFor()`；
冷启动（内存里没历史）时 `historyFor` 从 turns 表回填 50 条，于是当前这句
既进了 `history`、又作为 `message` 传了一次 → 模型以为对方说了两遍。
表情包最刺眼：一个表情被读成「两个 524，同一个表情发了两遍」。
**每次重启后的第一条消息都会中**，所以以前看着像「表情包的问题」。

- 修法：`service.ts` 加 `withoutCurrent(hist, text)`，三处取历史都过它
  （只剔「最后一条且一字不差」，对方真的连发两句时前一句仍然保留）
- 顺手补了两层防重：`cqcode.ts` 同一句里同一个 face id 只描述一次；
  `vision.ts` 同一句里同一张图只跑一次「看图 + 读意思」（以前重复段会花两次模型调用）
- 验收：`node tools/verify-dup-message.ts`（7 项）、`node tools/verify-sticker-once.ts`（8 项）

**② 它能看自己的日志了**

- 新工具 `read_log`（`src/tools/logs.ts`，只读）：参数 `lines`（默认 40，上限 200）、
  `filter`（关键词）、`onlyErrors`（只看报错）。读 `data/logs/bot.log`，时间戳整理成本地
  `HH:MM:SS`，单行截断 240 字、整体上限 6000 字，不会把上下文撑爆。
- 挂在 `buildTools` 里，现在共 37 个工具（提示词的【工具】一节会自动带上）
- 验收：`node tools/verify-log-tool.ts`（8 项，含「真的调一次」和「日志不存在时说人话」）

**③ 走神在聊天中间乱开口（16:28 修）**

症状：它回完「哦，表情。」**1.6 秒**后自己开口催「排序脚本」，你回「你要什么排序脚本」——
那个话题是凌晨聊过的旧账，它却当成刚想起的事。

三个原因叠在一起：

1. `busyRecently()` 看的是**本 service 实例**的 `lastActivityAt`；聊天走 router 里的
   per-user service，走神走 bot.ts 另建的 autonomyService —— 走神根本看不见你刚说过话。
2. `lastActivityAt` **从来没声明过**（只声明了 `lastMessageAt`）→ `Math.max(undefined, …)`
   是 `NaN` → `busyRecently` 永远 false。
3. `thinkIdleSeconds: 30` 只打在启动日志里，**代码里从没拿它判过**（死配置）。

修法：

- `service.ts`：加全局 `touchActivity()` / `activityAgeMs()`，`handle` 开场、回完话、`act()` 都记；
  `busyRecently` 取 `max(实例, 全局)`，并补上 `private lastActivityAt = 0`
- `autonomy.ts` `thinkOnce`：先判「他 `thinkIdleSeconds` 秒内说过话没」，再判 settle 窗口
- `service.ts` `think()`：提示词里加【刚才在聊什么】（库里最近 6 轮）+「想到的正是刚在聊的、
  或刚被否掉的就别发；别催他」
- 验收：`node tools/verify-think-gate.ts`（10 项，含跨实例、刚说话不走神、提示词带真实最近对话）
- 生产证据（重启后第一次走神）：安静 131 秒才动，且选了「做」不是「聊天」→ 没打扰人

**④ 抖音拿掉 + 它自己说的话进上下文（16:39 修）**

抖音：走神「内容」那条途径原来写的是「抖音或 B 站」，手机工具说明里也拿抖音当例子
（日志里两次 `phone_tap_text({"text":"抖音"})` 就是这么点开的，还写了「滑了四条，没一条是我选的」）。

- `service.ts` 走神提示词：`二、抖音或 B 站` → `二、B 站`
- `autonomy.ts` 玩手机提示词：加一句「不看短视频」
- `tools/phone.ts`：`phone_open_app` / `phone_tap_text` 里**硬拦**（包名 `aweme|douyin`、
  文字含「抖音」）→ 返回「不看抖音——这个定过了」。提示词会被忽略，这一层不会。
  想放开：删掉 `DOUYIN_APP`/`DOUYIN_WORD`/`isDouyin` 和两处 `if (isDouyin(...))`

自己说的话不进上下文：`recordSaid()` 只把话写进 `turns` 表，而聊天用的那个 service 实例
历史缓存一旦填上就不再读库（`historyFor` 命中缓存直接返回）→ 它看不见自己刚说的那句，
你顺着回，它就「我什么时候要过这个」。

- 修法：`service.ts` 加 `liveServices` 实例表 + `dropHistoryCaches()`，
  `recordSaid()` 写完就清；各实例下次从 `turns` 表重读
- 验收：`node tools/verify-selfcontext.ts`（11 项，含跨实例、prompt 里真有这句、抖音拦截）

**⑤ 群里 @ 别人，它当成在点自己（16:53 修，只做了 A 档）**

现场：`[消息] 他: @10002` → `[回复] @我干嘛，排序的事我还没翻完。`

根因：`people`（QQ ↔ 名字，库里 6 个人：他 / 某人 / 兰因絮果 / 小明 / 小红 …）
**只在 `say()` 调试路径传过**，回话主链 `handle()` 的 buildChatPrompt 压根没传 →
persona 里那段【谁是谁】**在正常对话里根本不出现**，`@10002` 就是纯数字。
加上它自己的号（30001）也不在表里，@它和@别人在文字上长得一模一样；
群策略是 `all`，`mentioned` 只在 `mention` 模式用，所以没有任何「这句不是对我说的」的信号。

修法（A 档：把信息给到，不动群策略、不改 @ 渲染）：

- `service.ts` `promptExtras()` 里加 `people / peopleQq / selfQq`（`handle` 和重试都走它）
- `persona.ts`：【谁是谁】里**把自己也写进去**（`30001 = 你自己（凝）`），
  末尾加规则「消息里的 @123456 就是 @这个 QQ 号的人，别当成在叫你」；
  空名字的人（`10003 = `）和 `QQ123` 占位别名不再塞进去
- 验收：`node tools/verify-at-people.ts`（8 项，**走真的 handle()**，把发给模型的 messages 截下来看）

还没做的（说过要留到下一轮）：B 把 @ 渲染成名字（`@某人`）、C 不加规则、
D 把 `groupSpeakThreshold` 真正接上（现在它只定义、只显示，**代码没读过它做判断**）。

**⑥ 人 → 锚点 → 角色 → 内容（16:58 做，按 他 的思路）**

库里「同一个人」曾经散成好几份，光有号码→名字不够它理解上下文：

```
people 6 行，其中 5 行的 anchor_id 指向不存在的锚点（悬空）
同一个人两份锚点：名字锚点（某人 / 主人）+ 号码锚点（10002 / 10001）
event_anchors.role：mentioned 4949 / subject 7 / speaker 0 —— linkEventPerson() 从没被调用
```

做法：**不合并、不搬数据**（合并污染过一次，不敢再来）

- 新增 `src/person-graph.ts`
  - `linkPeopleToAnchors()`：挑「挂事最多」的锚点当主锚点（保住已有的 850/1219 条关联），
    写 `external_id`，其余名字/号码做成别名指过来，修掉 people 的悬空引用；
    号码名字的锚点（她自己的 30001）也补上 external_id → 幂等
  - `syncSpeakerRoles()`：`events.speaker_id`（睡眠已从 turns 带过来，1115/1512）→ 写 `role='speaker'`
  - `personCard()` / `personCardsFor()`：拿「他是谁 + 他说过什么 + 关于他的」的卡
- `sleep.ts` 的 contract-identities 步骤里调这两个（每次睡完自动维护）
- `service.ts` `promptExtras()` 交 `personCards`：**当前说话人 + 被 @ 的人**（最多 2 张，每张 2+2 条）
- `persona.ts`：把卡挂到【谁是谁】**这个人的名字下面**（"他说过的：… / 关于他的：…"）
- 回填：`node tools/backfill-person-graph.ts`（自己先做快照；`--dry` 只看）
  结果：speaker 0 → 844 条，别名 +9，修悬空 5，external_id 6 → 12
- 验收：`node tools/verify-person-cards.ts`（21 项，含幂等、卡内容、提示词里真挂上了）

**⑥b 更正：`凝` 和 `他` 不是脏值（17:05）**

上一版我把 `speaker_id` 里非纯数字的东西统称「脏值」，是错的：

```
speaker_id = 10001 / 10002 …  → 号码
speaker_id = 他                       → 就是 10001 的名字（1 条）
speaker_id = 凝                        → 就是她自己（6 条）
speaker_id = 30001                → 她自己的号（12 条，之前 people 里根本没有她！）
speaker_id = 他                        → 代词，这个才是真的归属不了（11 条）
```

- 新增 `ensureSelfPerson()`：**把她自己写进 people**（30001 = 凝），
  `BotService` 构造时调用 → 她的 18 条发言（12 条号码 + 6 条自称）现在归到她名下，
  提示词里她自己那行下面也有「你自己说过的：…」
- 新增 `resolveSpeakerAnchor()`：号码 / 名字 / 自称 / 别名 → 同一个人；
  代词（`isPronoun`：他 她 你 我 咱…）如实返回 null 并计数，**不猜**
- `syncSpeakerRoles()` 改用它：覆盖 844 → **863** 条（`他` 11 条仍然跳过）
- 回填重跑：`node tools/backfill-person-graph.ts` → people 6 → 7 人

**⑥c 代词那个「他」是我们自己塞的（17:04）**

`speaker_id` 里那 11 条「他」不是模型理解错，也不是脏数据，是**抽取提示词自己打的标签**：

```ts
// llm/extract-v3.ts（改之前）
`[${t.id}] ${t.speakerId || (t.role === "user" ? "他" : "凝")}: ${t.text}`
```

没标说话人的消息被打上「他」，而 schema 要求 `evidence.speaker` 填 QQ 号，
模型有时就照抄了这个标签 → 库里出现 `speaker_id = "他"`。

改法（不是「加一段代词说明」，**说明只会让它更绕**）：

- 没标说话人的改成 `（没标说话人）`；规则里加一条
  「evidence.speaker 必须是号码；标「（没标说话人）」就留空；绝对不要写「他」「她」「我」「你」」
- 顺手修掉一句重复的规则：`10. 说话人用 QQ 号：他 就是 他` → `他 = 10001，你自己 = 30001`
- `person-graph.ts` 新增 `resolveViaEvidence()`：代词/认不出的，用事件自己的
  `evidence.msg_id → turns.speaker_id` **倒回真人**（11 条全能倒：10 条 他、1 条某人），
  倒回来的同时把 `events.speaker_id` 修成号码（检索的 `speakerFactor` 在用它）
- 结果：speaker 863 → **874**，库里「他」当说话人 **0 条**
- 验收：`node tools/verify-person-cards.ts`（30 项）

**⑦ 能看到全部群成员了（17:08）**

以前 `people` 只在**有人说话**时才加行，所以群里没开口的人它一概不知道。
现在从 OneBot 拉名册：

- `onebot.ts`：`getGroupMemberList(groupId)` + `parseMemberList()`（`get_group_member_list`，
  群名片优先、号码不合法丢掉）
- 新增 `group-roster.ts`：`group_members` 表（群号+QQ 为主键），**整群覆盖写**
  （有人退群就该消失，不是只增）；`rosterLine()` 给提示词一行群情
  · 人少（≤40）：直接列全名；人多：只给前 40 个 + 提示「要全部就调 group_members」
  · 还会点出「其中 N 个开过口，其余只见过名字」
- 新增工具 `group_members`（`src/tools/roster.ts`）：查全量成员、可只看群主/管理
- `bot.ts`：连上后 5 秒拉一次，之后每 30 分钟刷新（进出群、改名片都能跟上）
- `service.ts` `promptExtras()` 交 `groupRoster`，`persona.ts` 挂在【这里是哪儿】下面
- **名册不塞进 people**：people 是「跟她说过话的人」，进 people 会挤满【谁是谁】和人物卡；
  名册只用来回答「群里都有谁」，真开口了才走 `ensurePerson`
- 实测（重启后）：3 个群名册 5 / 3 / 5 人，提示词里那行形如
  `这个群共 5 人：J.Y.💸、兰因絮果、凝、南极居士、他。其中 3 个开过口：…；其余 2 个你只见过名字。`
- **顺带修掉一个真 bug**：`handle()` 里 `recallQuery` 声明在 try 内，但「第一轮回得太短（<4 字）」
  的宽松重试在 try 外用它 → `ReferenceError` → 每次都退成兜底句「我这会儿有点转不动」。
  已提到 try 外。以前群里回一个「嗯」大概率就是这样挂的。
- 验收：`node tools/verify-roster.ts`（17 项，含整群覆盖、人多截断、工具、提示词、
  以及「短回复走重试不炸」）

**⑧ 「图片很糊」= 眼睛没在跑（17:12）**

不是千问对接的问题，是本地 Ollama **根本没启动**：`ollama.exe` 在、模型都在
（`qwen2.5vl:7b` 6.0GB / `qwen3:8b` 5.2GB），但 11434 没监听。
`describeImage` 失败 → 代码回退成 `item.summary || "看不清"` → 它只能说「图太糊」。

- 修：`vision.ts` 失败时把原因带出来 —— `动画表情（看图没成功：本地模型报错：502）`
  或者 `看不清：眼睛没启动（Ollama 没跑）`，不再把「服务没起」说成「图糊」
- 已启动 Ollama（`ollama serve`），实测一张真截图：**5.6 秒，描述准确**
- ⚠️ 启动文件夹里有 `Ollama.lnk`，但今天它没起来（上次是 08:38 手工起的）。
  要不要加一个 logon 计划任务（带失败重试）等你定。

**⑨ 工具轮次上限删掉（17:12）**

以前一层层卡：`toolchat.ts maxRounds=4` · `respond(maxRounds=8)`（聊天实际 8 轮）·
`act(…,25)` 玩手机 · `think()` 用 `tuning.maxToolRounds`（20）。
它常常是真还有事要办——开个 App、读一屏就被掐断。

- 现在：`maxRounds = 0` 表示**不限**，跑到模型自己不再调工具为止；
  只在 `toolchat.ts` 留一个 `HARD_ROUND_CAP = 999` 兜真死循环。真正的刹车是每日预算 + 单次超时
- 想硬刹车仍可显式传正数（`tune_reply` 里 `maxToolRounds` 改成「0 = 不限」，上限 200）
- `data/tuning.json` 的 `maxToolRounds` 已改成 0
- 验收：`node tools/verify-tools-unlimited.ts`（连调 12 轮不掐断；显式给 3 仍然 3 轮停；
  看图失败时说真话）

**⑩ 外部报告核对：仓库不自包含（19:55 修完，已推 bb6f8ad）**

有人用 GitHub 版跑，报「自动整理不行 / X no such column: stage」。核对结果：

- 那个错**能复现**，但条件是「库是旧 schema」：造一张没有 `stage` 的 events 表，
  `openDb()` 立刻报 `no such column: stage`。`stage` 从第一个提交就在建表语句里——
  真正的原因是 **migrate() 先建索引再补列**：`CREATE INDEX ... ON events(stage)`
  在补列之前执行，老库必炸。
- 更实际的：**仓库不自包含**。`.gitignore` 把整个 `data/` 忽略，而 `cli.ts init` 硬依赖
  `data/seed-anchors.json`、README 让 `cp data/bot.example.json`——两个文件仓库里都没有。
  新人 clone 下来第一条命令就 ENOENT。
- **最严重**：events 的 12 个 v3 字段（etype/status/responsible/time_*/place/evidence/
  sensitivity/expires_at/memory_value/valid_to/superseded_by）**只在线上库里**
  （开发时用临时补丁脚本加的），从没合进 SCHEMA。别人新建的库存不下，抽出的事件是空壳。
  `anchors.external_id`、`people` 表同样是运行期懒建，新库睡眠直接报错。

修法：

- `db.ts`：SCHEMA 补齐 12 个 v3 字段 + `people` 表 + `anchors.external_id`；
  `migrate()` 先补 `stage` 再建索引，老库补全部 12 列
- `cli.ts`：`init` 缺种子不再崩，提示「先用空锚点」
- 仓库补 `data/bot.example.json`（占位）+ `data/seed-anchors.json`（脱敏），
  `.gitignore` 改成 `data/*` + 两个 `!` 例外；README 改成「先 init 再 cp 示例」
- 验收：**从 git index 导出干净副本**（等价 fresh clone）→ `init` → cp 示例 →
  灌 3 句对话 → `sleepAsync(假模型)`：事件带 `status/etype/memory_value/place`，不报缺表缺列

**推送坑**：`git push` 报 `schannel: server closed abruptly`（直连/代理都不行），
换 TLS 后端就成了：`git -c http.sslBackend=openssl push origin master`。以后推不动先试这个。

**发版自检**：`powershell -NoProfile -File tools\verify-fresh-clone.ps1`
（真去 clone GitHub、照 README 走 init → cp 示例 → 灌 3 句对话 → 假模型抽取，
11 项断言；刚跑过是 PASS。注意这台机器没有 `pwsh`，要用 `powershell`）

写这个脚本踩的两个坑（以后写 .ps1 记住）：
1. `$ErrorActionPreference = "Stop"` + 调 `git`：git 往 stderr 写 "Cloning into…"，
   Windows PowerShell 5.1 会把它当成致命错误直接中断 → 改成显式判 `$LASTEXITCODE`。
2. 脚本必须纯 ASCII：PS 5.1 按 ANSI 读文件，UTF-8 中文注释会把脚本喂坏（今天已经栽过一次）。

## 四、这个文件的坑（血泪）

```
src/bot/service.ts   中文有 5671 处乱码、大量行被压成超长行
                     改它之前先备份；按字面匹配，匹配不到就停手
                     不要按行号改
src/llm/extract.ts   老抽取路径，3132 处乱码，v3 已接管，别动
src/bot/config.ts    1053 处乱码全在注释，不影响
```

**规矩：**

1. 改任何文件前先 `Copy-Item` 备份到 `data/backup-<原因>-<时间>/`
2. 用 Node 的 `readFileSync/writeFileSync`（UTF-8）改，**不要用 PowerShell 的 Set-Content 写中文**
3. 改完必须跑真实入口（`router.handle` / `think` / `sleepNow`），不能只 import
4. 涉及提示词的，把拼出来的 prompt 打出来看有没有那一段

## 五、关键数字（截至今天）

```
记忆 1103 条（243 条新版事件卡）
锚点 事 243 / 人 11 / 环境 3 / legacy 64 / merged 10
边   116 条
待跟进 50 条
```

## 六、重启方法

⚠️ **别用 `schtasks /End` + `/Run` 连着来**：两者有竞态，End 的信号会落到刚起来的新实例上，
exit code `-1073741510`（STATUS_CONTROL_C_EXIT），stderr 里只剩一个 `^C`。
2026-10-26 就因此"神秘死掉"过两次（17:12 和 19:37）。

```powershell
# 1) 只杀进程，不发 /End
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*bot.ts*' } | Stop-Process -Force
Start-Sleep -Seconds 2
# 2) 只 Run
schtasks /Run /TN "whale-bot"
Start-Sleep -Seconds 12
# 3) 必须验证：进程在、任务 Running、stderr 没有 ^C
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*bot.ts*' } | ForEach-Object { "PID=$($_.ProcessId)" }
schtasks /Query /TN "whale-bot" /V /FO LIST | Select-String 'Status|Last Result'
Get-Content data\logs\stderr.log -Tail 3
```

如果 `Last Result` 是 `-1073741510` 或 stderr 有 `^C`，说明又被 `End` 打死了——重跑第 2、3 步。
