# 装 Ollama + 拉模型：离线操作手册

> 场景：你要翻墙下载，翻墙期间和 AI 的连接会断。所以这份文档是**自包含**的——
> 每一步都写了「该看到什么」，你不用回来问我。
> 全部做完、关掉代理之后再回来，跑最后一节的验证命令即可。

---

## 0. 先解决一个根本问题（强烈建议，只需一分钟）

你说「翻墙之后和你就没链接了」。DSH 的界面在 `127.0.0.1:19387`，走的是本机回环地址，
**正常代理不该影响它**。断掉的真正原因通常是下面两条之一：

1. 代理开的是 **TUN / 全局接管模式**，把本机回环流量也劫持了；
2. 代理改了 DNS，导致 DSH 连不上模型 API。

**改法**（在你的代理工具里做，各工具位置不同，一般在「设置 → 路由 / 分流 / 绕过」）：

- 把 `127.0.0.1`、`localhost`、`::1`、`192.168.*` 加进**直连（DIRECT）**列表；
- 把 DSH 用的模型 API 域名也加进直连（DeepSeek 是 `api.deepseek.com`）；
- 模式选**规则分流（Rule）**，不要选全局（Global）。

改好之后你应该可以「开着代理跟我聊天」，后面就不用反复切换了。
**改不了也没关系**，按下面流程走一遍就行。

---

## 1. 下载前列个清单

| 项目 | 大小 | 说明 |
|---|---|---|
| OllamaSetup.exe | 约 0.7–1.5 GB | 如果下下来只有几 KB，那是错误页，不是安装包 |
| qwen3:8b 模型 | 约 5.2 GB | 想先省时间可以用 qwen3:4b（约 2.5 GB） |
| 磁盘空闲 | ≥ 15 GB | 你目前有 110 GB，够 |

**注意：模型必须在代理还开着的时候拉。** `ollama pull` 走的是
`registry.ollama.ai`，关掉代理之后大概率拉不动。

---

## 2. 装 Ollama

### 2.1 下载

二选一（都要**在代理开着的时候**打开）：

- 官方页面：https://ollama.com/download/windows → 点 **Download for Windows**
- GitHub 直链（走 latest，不用管版本号）：
  https://github.com/ollama/ollama/releases/latest/download/OllamaSetup.exe

> 为什么必须挂代理：`ollama.com/download/OllamaSetup.exe` 会 302 跳转到 GitHub，
> 而你这台机器**访问 github.com 是超时的**（我实测：`Connection timed out`）。
> 但 `ollama.com` 网页本身是通的（HTTP 200），所以页面能打开、下载会卡住——别误判。

### 2.2 安装

双击 `OllamaSetup.exe`，默认安装即可：

- 装到 `%LOCALAPPDATA%\Programs\Ollama`，**不需要管理员权限**；
- 装完会自动启动，右下角托盘出现羊驼图标；
- 没有图标就手动启动：开始菜单搜 `Ollama`，或命令行跑 `ollama serve`。

### 2.3 立刻验证（这一步很关键）

开一个新 PowerShell 窗口，跑：

```powershell
ollama --version
```

**应该看到**：`ollama version is 0.4x.x`（比 0.6 新的版本即可）。
如果提示「无法识别的命令」，说明 PATH 还没刷新——**关掉这个 PowerShell 窗口重新开一个**。

> ⚠️ 你的显卡是 RTX 5070（Blackwell 架构，sm_120）。旧版 Ollama 不认这个架构，
> 会**悄悄退回 CPU 推理**，慢十倍以上。所以一定要装最新版，
> 装完看 `ollama --version` 的版本号别太老（0.6 以上稳）。

---

## 3. 拉模型（趁代理还开着）

```powershell
ollama pull qwen3:8b
```

**应该看到**：一串 `pulling manifest` → `pulling xxx` 的进度条，最后 `success`。

### 如果拉得很慢或者卡住

Ollama 认这两个环境变量，先设再拉（端口改成你自己代理的端口，常见 7890 / 7897 / 10809）：

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:HTTP_PROXY  = "http://127.0.0.1:7890"
ollama pull qwen3:8b
```

设完如果还是卡，把 Ollama 彻底退出（托盘右键 → Quit），再重开一次，让它继承环境变量。

### 想先省时间

先用小的把管道跑通，之后再换大的：

```powershell
ollama pull qwen3:4b     # 约 2.5 GB
```

### 拉完验证

```powershell
ollama list
```

**应该看到**：

```
NAME          ID              SIZE      MODIFIED
qwen3:8b      xxxxxxxxxxxx    5.2 GB    ...
```

---

## 4. 确认显卡真的被用上了

这一步很多人跳过，然后发现慢得离谱。

开一个窗口跑：

```powershell
ollama run qwen3:8b "用一句话介绍你自己"
```

它会边生成边显示。**同时**开另一个窗口跑：

```powershell
ollama ps
```

**应该看到**类似：

```
NAME        ID     SIZE     PROCESSOR          UNTIL
qwen3:8b    xxx    6.5 GB   100% GPU           ...
```

- 显示 `100% GPU` → 成功。
- 显示 `100% CPU` 或 `xx%/xx% CPU/GPU` → 显卡没吃上。按这个顺序排查：
  1. `nvidia-smi` 能不能正常显示显卡；
  2. 更新 NVIDIA 驱动到最新；
  3. 更新 Ollama 到最新版；
  4. 显卡被别的程序占满（比如 MuMu 模拟器），先关掉。

---

## 5. 关掉代理，回到 AI 这边

代理关掉后，把这些命令的输出发给我：

```powershell
cd %USERPROFILE%\Documents\deepseek-harness\default-workspace\whale-memory
ollama --version
ollama list
node src/cli.ts llm
```

**预期**：

```
ollama version is 0.4x.x
NAME          ID              SIZE
qwen3:8b      xxx             5.2 GB
抽取器：heuristic　地址：http://127.0.0.1:11434　模型：qwen3:8b
Ollama 在跑，已装模型：qwen3:8b
```

最后一条显示「Ollama 在跑」就说明全通了，我接着跑真实抽取对照。

---

## 6. 出错对照表

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `winget install` 报 `InternetOpenUrl() failed 0x80072efd` | 走 GitHub，被墙 | 就是本文档要解决的，用代理下安装包 |
| 安装包只有几 KB | 下到的是错误页 | 重新下，确认代理在工作 |
| `ollama` 命令找不到 | PATH 没刷新 | 关掉 PowerShell 重开 |
| `ollama pull` 卡在 `pulling manifest` | 代理没生效 | 设 `HTTPS_PROXY` 后重启 Ollama |
| `ollama ps` 显示 100% CPU | 显卡没识别 | 更新驱动 / 更新 Ollama / 关掉占显存的程序 |
| 提示 `Error: pull model manifest: 412` | 代理把请求改了 | 换代理节点或换 DNS |
| 端口 11434 被占 | 装了两份 Ollama | 托盘退出后重启一份；或 `ollama serve` 看冲突 |

---

## 7. 装完之后我会做什么（预告，你不用管）

1. 用真模型跑一遍你现在这 10 天数据集，和启发式做对照（同一批探针，比召回率和抽取质量）；
2. 先把情绪抽取换成模型（风险小），再换事件抽取（影响检索）；
3. 加睡眠期的「带全天上下文重读」；
4. 扩评估集到 50 条以上，加幻觉探针。

在此之前，代码保持 `extractor: "heuristic"` 默认值不变——**装不上也不影响现在能用**。
