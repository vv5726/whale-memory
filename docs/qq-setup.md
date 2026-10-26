# 接入 QQ：NapCat + 本机机器人

目标：让这个记忆系统挂在一个真 QQ 号上，能用过去的记忆聊天。
机器人自己的「大脑」是本机的 `qwen3:8b`（Ollama），聊天记录不出本机。

整体结构：

```
你的 QQ 号（手机扫码登录）
        │
   NapCat（协议端，模拟 QQ 客户端）
        │  OneBot 11 over WebSocket
        ▼
   node src/bot.ts
        ├── 收到消息 → 落盘到记忆库
        ├── 召回记忆 → 拼提示词
        ├── 调 Ollama 生成回复
        └── 发回去；闲置够久就睡一觉整理记忆
```

---

## 一、装 NapCat

NapCat 是「用你的 QQ 号登录、对外提供 OneBot 接口」的协议端。它跑在本地，不碰云端。

1. 下载：https://github.com/NapNeko/NapCatQQ/releases
   - 选 `NapCat.Shell.zip`（免安装版，最省事）
   - 如果 GitHub 连不上，用镜像前缀：`https://gh-proxy.com/<原始的 github 链接>`
2. 解压到一个固定目录，比如 `D:\NapCat`
3. 双击 `launcher.bat`（或 `napcat.bat`），按提示**用手机 QQ 扫码登录**
   - 建议用小号，别用主号；协议端有被风控的可能
4. 进入 WebUI（默认 http://127.0.0.1:6099），在「网络配置」里新建一个 **WebSocket 服务器**：

| 项 | 值 |
|---|---|
| 类型 | WebSocket 服务器 |
| 端口 | `3001` |
| Token | 自己编一个，比如 `whale-2026` |
| 消息格式 | `array` |

保存并启用。看到「已启动」就说明 NapCat 在 `ws://127.0.0.1:3001` 等着机器人连了。

---

## 二、配机器人

```powershell
cd %USERPROFILE%\Documents\deepseek-harness\default-workspace\whale-memory
node src/bot.ts --init
```

会生成 `data/bot.json`，把这几项改成你自己的：

```json
{
  "onebotWs": "ws://127.0.0.1:3001",
  "accessToken": "whale-2026",
  "selfId": 你的机器人QQ号,
  "allowPrivate": [你自己的QQ号],
  "allowGroups": [],
  "ollamaModel": "qwen3:8b",
  "idleSleepHours": 3,
  "dailySleepHour": 4
}
```

**`allowPrivate` / `allowGroups` 必须填，空的表示谁都不理**——这是防止别人发现你的机器人乱用你的模型。

配完先检查：

```powershell
node src/bot.ts --status
```

---

## 三、先不连 QQ，验证脑子是好的

```powershell
node src/bot.ts --say "王建国那两千块钱还了吗"
```

会打印两段：召回到的记忆 + 生成的回复。如果「召回到的记忆」是空的，说明记忆库还是空库（`data/qq-memory.db` 还没有对话），先灌点数据：

```powershell
node src/cli.ts ingest --db data/qq-memory.db          # 用 eval 数据集当模拟对话
node src/cli.ts sleep --db data/qq-memory.db --extractor llm --model qwen3:8b
```

---

## 四、启动

确认 Ollama 在跑（`ollama list` 能看到 qwen3:8b），然后：

```powershell
node src/bot.ts
```

```
[onebot] 已连上 ws://127.0.0.1:3001
[bot] 起来了。闲置 3 小时后自动睡一觉
```

用你允许的那个 QQ 号给机器人发条消息，它应该回你。
断开 NapCat 或关掉脚本，它都会自己重连 / 退出。

---

## 五、睡眠是怎么触发的

两个条件，哪个先满足都会睡：

- **闲置**：连续 `idleSleepHours` 小时没人说话 → 睡（符合「睡一觉才整理」）
- **每日兜底**：每天到 `dailySleepHour` 点 → 睡一次（防止一直有人聊天永远不整理）

睡眠期间机器人**照常回复**，只是那会儿的话先不整理，等下一次睡眠。

手动触发：

```powershell
node src/cli.ts sleep --db data/qq-memory.db --extractor llm --model qwen3:8b
```

---

## 六、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `[onebot] 连接断开，Xs 后重连` | NapCat 没启动，或者端口/Token 不对 |
| 发消息没反应 | `allowPrivate` 里没填你的 QQ 号 |
| 回复是「我这会儿脑子有点转不动」 | Ollama 没跑，或模型名不对（`ollama list` 看名字） |
| 回复很慢（10 秒以上） | 模型在 CPU 上跑。跑 `ollama ps`，要看 `100% GPU` |
| 它答得像个客服、总说「根据记忆」 | 说明提示词被人格段压不住，调 `src/bot/persona.ts` |
| 记忆里全是无关内容 | 召回闸门太松，调 `src/config.ts` 的 `factTopK` |

---

## 七、必须知道的三个风险

1. **风控**。协议端不是官方接口，小号也建议只在自己可控的内容里用，别拿它群发。
2. **隐私**。聊天记录会落到 `data/qq-memory.db` 这个文件里。**定期备份，别放网盘**。
3. **它会说错话**。记忆有偏差时它会很自信地答错。这是这套设计的固有代价，不是 bug——但意味着**别让它替你做任何有后果的承诺或决定**。

---

## 八、不装 NapCat 也能测

```powershell
node tools/bot-smoke.ts
```

它会自己起一个假的 OneBot 服务器，把「收消息 → 落盘 → 召回 → 回复 → 发回去」整条链路跑一遍，14 项检查。
