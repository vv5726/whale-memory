import type { MemoryConfig } from "./types.ts";

/**
 * 默认配置针对「单人长期」场景。
 *
 * contextBudgetTokens 是「能被载入上下文的总量」，不是磁盘容量：
 * 1M 上下文就意味着 30 万 token 的记忆算「最近、清晰」，再往后才开始压缩。
 * 实际部署时应该设成所接模型上下文长度的一个合理比例。
 */
export const DEFAULT_CONFIG: MemoryConfig = {
  contextBudgetTokens: 1_000_000,

  // 三层比例：最新 30% 清晰，30%~80% 压缩，最旧 20% 只剩感受 + 一个片段
  detailedQuota: 0.3,
  compressedQuota: 0.5,

  // 刻意压低：人类对时间不敏感，日期只当排序用的弱信号
  recencyWeight: 0.1,

  hopDecay: [1.0, 0.5, 0.25],
  maxHops: 2,

  // 越旧越难自己浮现，这是设计而不是缺陷
  tierAccessibility: {
    detailed: 1.0,
    compressed: 0.75,
    fossil: 0.35,
  },

  factTopK: 5,
  /** 抽取时的温度：0 完全一致（会写成模板），0.3 有变化但不飘 */
  extractTemperature: 0.3,
  probabilisticPool: 8,
  temperatureBase: 0.6,
  temperatureArousalGain: 1.2,

  pinnedBonus: 0.6,
  arousalBonus: 0.35,

  wakeThreshold: 0.45,
  // 平时不读底片：只给地址，要细节就显式 deref
  autoWakeContent: false,

  // 钉住的三道闸：总量、每日新增、有效期
  pinnedLimit: 50,
  pinnedDailyLimit: 3,
  // 承诺有期限（「明年一起去云南」这种一年内的约定），过了日子就该松手
  pinnedTtlDays: 400,
  // 但身份类事实没有期限：密码、生日不会「过期」
  pinPermanentPatterns: ["密码", "手机号", "生日", "最喜欢", "不喜欢"],
  pinPatterns: [
    "约好",
    "说好",
    "答应",
    "约定",
    "记住",
    "别忘了",
    "别忘",
    "一定",
    "密码",
    "手机号",
    "生日",
    "最喜欢",
    "不喜欢",
  ],

  salienceDecay: 0.98,
  identityMergeThreshold: 0.99,
  // 推断锚点用弱权重挂上：能被想起来，但不假装是事实
  bindInferredAnchors: true,

  // 默认走启发式；装了 Ollama 之后把 extractor 改成 "llm"
  extractor: "heuristic",
  llmBaseUrl: "http://127.0.0.1:11434",
  llmModel: "qwen3:8b",
  llmTimeoutMs: 120_000,
  freezeExtractions: true,
};

export function withOverrides(base: MemoryConfig, patch: Partial<MemoryConfig>): MemoryConfig {
  return { ...base, ...patch };
}


