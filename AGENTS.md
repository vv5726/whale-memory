# 工程约定（写给改这个项目的人，也写给以后的自己）

今天在一个文件上栽了三次，都是同一个原因：**改完没有真正验证，而且写文件的方式会静默改坏内容。**

## 一、写文件：必须显式 UTF-8

```powershell
# ❌ 会静默把中文写成 ?，正则里出现 ?? 就直接语法错
Set-Content src\bot\service.ts -Value $s -NoNewline

# ✅ 永远带上编码
Set-Content src\bot\service.ts -Value $s -Encoding utf8 -NoNewline
```

**更稳的做法**：改代码用编辑工具（按字面替换），不要用 PowerShell 读全文再写回。

## 二、数组 + `-NoNewline` = 静默压成一行

```powershell
# ❌ $lines 是数组，-NoNewline 会把它们无缝拼成一个字符串 → 46KB 变 1 行
$lines = Get-Content file
Set-Content file -Value $lines -NoNewline

# ✅ 二选一
Set-Content file -Value $lines                 # 不加 -NoNewline
$c = Get-Content file -Raw; Set-Content file -Value $c -Encoding utf8 -NoNewline   # -Raw 是字符串
```

## 三、改完必须验证「真实路径」

**语法检查只证明能 import，不证明会工作。**

今天的四个坑：

| 错误 | 症状 |
|---|---|
| `loadTuning` 没 import | 崩溃 |
| `modeFor` 没 import | 崩溃 |
| `senderFields` 造了没返回 | 静默失效 |
| 字段加到了错误的函数上 | 静默失效 |
| `extractV3` 开关没传到抽取层 | 静默失效 |

**规矩：**

1. `node --input-type=module -e "await import(...)"` —— 只证明语法
2. **再跑一次真实入口**（`svc.handle(...)` / `sleepNow()`），看结果对不对
3. 涉及字段/开关的，**把真正拼出来的东西打出来看**（不是看文件里有没有，是看运行时有没有）

## 四、破坏性操作前先备份

```powershell
Copy-Item data\memory.db "data\backup-<原因>-<时间>.db"
```

**今天回滚过三次**：删锚点打空网络、合并污染数据、写坏 service.ts。
每次都靠备份救回来。

## 五、不要用「按行号」改文件

按行号替换会把别的代码一起冲掉（今天的 `my_view` 解析就是这么没的）。
**用字面内容匹配**，匹配不到就停下来看真实内容，不要硬改。

## 六、改完这一条的验收清单

```
□ 语法过（import 一次）
□ 真实入口跑一次（handle / sleepNow / 工具调用）
□ 把运行时真正用的东西打出来核对
□ 有开关的，确认开关真的传到了用它的那一层
□ 数据相关：先备份
```
