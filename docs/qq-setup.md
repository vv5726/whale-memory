# 接入 QQ：SnowLuma + 本机机器人

目标：让这套记忆挂在一个真 QQ 号上，能用过去的记忆聊天。

整体结构：

```
电脑版 QQ（登录机器人那个号）
        │  SnowLuma 挂在 QQ 进程上（Hook）
        ▼
   SnowLuma（协议端，自带 Node 运行时 + 网页后台）
        │  OneBot 11 over WebSocket
        ▼
   node src/bot.ts
        ├── 收到消息 → 落盘到记忆库
        ├── 召回记忆 → 拼提示词
        ├── 调模型（DeepSeek，或本地 Ollama）生成回复
        └── 发回去；聊完几分钟就睡一觉整理记忆
```

> 本文按**本机实测的 SnowLuma 2.2.0（win32-x64）**写。任何讲 OneBot 11 的协议端（NapCat、LLOneBot…）也能接，差别只在"端口和 Token 配在哪"，第四节之后完全一样。

---

## 一、先想清楚代价

协议端不是官方接口，**用小号**，别用主号。它会挂在你电脑上的 QQ 进程里——QQ 退了，机器人也就断了。

还要有：一台常开的 Windows 电脑、一个机器人 QQ 号、一个模型 key（或用本地 Ollama）。

---

## 二、装 SnowLuma

SnowLuma 是一份**自带 Node 运行时的自包含分发包**，解压就能跑：

```
D:\SnowLuma\
├─ node.exe            ← 它自己带的运行时，不用另装
├─ index.mjs           ← 主程序
├─ launcher.bat        ← 双击启动（先查 Node 版本，再跑 index.mjs）
├─ config\             ← 配置：onebot_<QQ号>.json / webui.json / runtime.json
├─ logs\  data\  native\
└─ client\             ← 网页后台的前端
```

1. 解压到一个固定目录（**别放带空格的路径**），双击 `launcher.bat`
2. 第一次启动会在控制台打印**网页后台的初始账号密码**：

   ```
   [WebUI] initial credentials: user=admin password=xxxxxxxxxxxx
   [WebUI] listening http://127.0.0.1:5099
   ```

   打开 `http://127.0.0.1:5099`，先同意 EULA / 隐私协议，**马上把密码改掉**——那个初始密码只在启动时显示一次。

3. 在**电脑版 QQ 上登录机器人那个号**。SnowLuma 会自动挂上去，日志里出现这两行就成了：

   ```
   [Hook] login detected: PID=xxxx UIN=你的机器人QQ号
   [OneBot] session started: UIN=你的机器人QQ号
   ```

---

## 三、OneBot 接口（它默认起两个）

登录成功后，SnowLuma 会自己开两个入口：

| 类型 | 地址 | 谁用 |
|---|---|---|
| HTTP | `http://127.0.0.1:3000` | 想直接用 HTTP 调 API 的 |
| **WebSocket 服务器** | **`ws://127.0.0.1:3001`** | **本项目的机器人连这个** |

配置在 `config/onebot_<机器人QQ号>.json`。**要设 Token 就在这里设**，设了之后机器人那边的 `accessToken` 必须跟它一模一样；不设就两边都留空。

日志里对应这两行，端口对不上就改配置：

```
[OneBot.HTTP] [http-default] listening 127.0.0.1:3000/
[OneBot.WS-Server] [ws-default] listening 127.0.0.1:3001/
```

---

## 四、配机器人

```powershell
cd <你 clone 下来的目录>
copy data\bot.example.json data\bot.json
```

改这四项就够跑起来：

```json
{
  "onebotWs": "ws://127.0.0.1:3001",
  "accessToken": "<和 SnowLuma 那边一致，没设就留空>",
  "selfId": 机器人QQ号,
  "allowPrivate": [你自己的QQ号],
  "allowGroups": [],
  "provider": "deepseek",
  "deepseekApiKey": "sk-..."
}
```

**`allowPrivate` / `allowGroups` 必须填，空的表示谁都不理**——这是防止别人发现你的机器人然后白烧你的模型钱。

改完先自检：

```powershell
node src\bot.ts --status
```

---

## 五、先不连 QQ，验证脑子是好的

```powershell
node src\bot.ts --say "王建国那两千块钱还了吗"
```

会打印两段：召回到的记忆 + 生成的回复。空库时记忆段是空的，先灌点演示数据：

```powershell
node src\cli.ts init
node src\cli.ts ingest
node src\cli.ts sleep
node src\cli.ts recall --text "我妈那次手术结果还好吗"
```

---

## 六、启动

```powershell
node src\bot.ts
```

看到这两行就接上了：

```
[onebot] 已连上 ws://127.0.0.1:3001
[bot] 起来了。回复后端：DeepSeek API（deepseek-chat）
```

用白名单里的号给机器人发条消息。SnowLuma 断了或 QQ 退了，机器人会自己重连。

---

## 七、睡眠是怎么触发的

四个条件，哪个先满足都会睡（都在 `data/bot.json` 里）：

| 条件 | 默认 | 含义 |
|---|---|---|
| `idleSleepMinutes` | 3 | 聊完 3 分钟就整理一次——**主力触发** |
| `sleepForceThreshold` | 50 | 攒够 50 条没处理的对话就强制整理（0 = 关） |
| `idleSleepHours` | 12 | 长时间没人说话再收一遍（0 = 关） |
| `dailySleepWindow` | `[3,5]` | 每天 3–5 点做整日整理 |

睡眠期间机器人**照常回复**，只是那几句先不整理，等下一次。手动触发：让她自己调 `memory_tidy`，或者跑 `node src/cli.ts sleep`。

---

## 八、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `[onebot] 连接断开，Xs 后重连` | SnowLuma 没起 / 端口不对 / Token 不一致。先看它日志里 `WS-Server listening` 那个端口 |
| 网页后台打不开 | 默认 `http://127.0.0.1:5099`；看 `snowluma.out.log` 里 `[WebUI] listening` 那一行 |
| 发消息没反应 | ① `allowPrivate` 没填你的号 ② 群没进 `allowGroups` ③ 群模式是 `mention` 而你没 @ 她 |
| 同一条消息回两遍 | 去重窗口被改小了。`src/bot/onebot.ts` 里是 90 秒，别动 |
| 回复是「我这会儿有点转不动」 | 模型没通：`provider` / `deepseekApiKey` 写错，或 Ollama 没跑（`ollama list`） |
| 它答得像个客服 | 人格段没压住。改 `data/persona.md`（她自己也能改） |
| 记忆里全是无关内容 | 召回闸门太松：`src/config.ts` 的 `factTopK`，或 `v3MinValue` 调高 |

---

## 九、必须知道的三个风险

1. **风控**：协议端不是官方接口，小号也可能被限。别拿它群发、别到处拉群。
2. **隐私**：聊天记录落在 `data/memory.db` 里。**定期备份，别放网盘、别提交到 git**（`.gitignore` 已经排掉了 `data/`）。
3. **它会说错话**：记忆有偏差时它会很自信地答错。这是这套设计的固有代价，不是 bug——所以**别让它替你做任何有后果的承诺或决定**。

---

## 十、不装 SnowLuma 也能测

```powershell
node tools\bot-smoke.ts
```

它会自己起一个假的 OneBot 服务器，把「收消息 → 落盘 → 召回 → 回复 → 发回去」整条链路跑一遍，不需要 QQ。
