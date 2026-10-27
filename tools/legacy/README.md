# legacy：历史脚本，不保证能跑

这里是从 `tools/` 根下挪进来的**一次性脚本**——开发过程中用来打补丁、查数据、对比、临时诊断的。

**不要把它们当成接口。** 它们大多：

- 硬编码了当时的路径、日期、字段名
- 依赖当时数据库的结构（后来加过列，可能对不上）
- 跑完就不该再跑第二遍（有的会直接改库）

留在这里只是为了**能查到"当时是怎么改的"**，不是为了能重跑。

## 留在 `tools/` 根下的是这些

| 前缀 | 是什么 |
|---|---|
| `verify-*.ts` | **回归测试**，改完代码该跑的（`verify-handle` / `verify-edge-logic` / `verify-fossil-budget` …） |
| `check-*.ts` | 编码、连接、字段这类体检 |
| `compare-*.ts` | 两个抽取器 / 两次召回的内存占用与质量对比 |
| `bot-smoke.ts` | 起一个假 OneBot，把整条链路跑一遍（不需要 QQ） |
| `build-report-html.py` | 把对比数据画成报告页 |

## 改代码之后的验收清单

```
□ node tools/check-encoding.ts          # 中文没被写坏
□ node tools/verify-handle.ts           # 真跑一次回话
□ node tools/verify-edge-logic.ts       # 动过边
□ node tools/verify-fossil-budget.ts    # 动过分层
□ node tools/bot-smoke.ts               # 动过接入层
```

**只看"import 成功"不算验证。** 这个项目上已经因为这件事栽过四次。
