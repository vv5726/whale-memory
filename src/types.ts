/** 三层记忆。名字按人类直觉取，tier 只降不升。 */
export type Tier = "detailed" | "compressed" | "fossil";

/** 事件处理阶段，睡眠任务用它做断点续跑。 */
export type Stage = "extracted" | "compressed" | "fossilized";

export type AnchorKind = "person" | "place" | "thing" | "theme" | "event";

/** 一条记忆携带的情绪。压缩到最狠也要留住这部分。 */
export interface Affect {
  /** -1 到 1，负为难受 */
  valence: number;
  /** 0 到 1，情绪强度。强度高的记忆更容易被随机抽取 */
  arousal: number;
  tags: string[];
  /** 一句话主观总结，fossil 层唯一必须保留的内容之一 */
  summary: string;
  /** 与这份感受绑定的核心片段，压缩到最狠也只留它 */
  core: string;
}

export interface EventRow {
  id: string;
  day: string;
  ts: number;
  periodLabel: string | null;
  tier: Tier;
  stage: Stage;
  title: string;
  detail: string | null;
  cause: string | null;
  effect: string | null;
  coreFragment: string | null;
  affect: Affect;
  /** 现在回想起来的感受（和当时分开） */
  feltNow?: { valence: number; arousal: number; at: number };
  pinned: boolean;
  sizeTokens: number;
  archived: boolean;
  /**
   * 关键事实：多年后仍要准确复述的那几个词（金额、日期、结论、专名）。
   * 和 affect 一样，任何层都不许压缩掉。
   */
  keyFacts: string[];
  /** 强度：被重复提起多少次就抬多少。越强越抗遗忘、越容易被想起。 */
  strength: number;
  /** 同一件事被提起的次数 */
  mentions: number;
  /** 这条解读是基于哪几条旧记忆得出的（幻觉追责用） */
  derivedFrom: string[];
  /** 写入时识别出的处境标签：medical / conflict / promise / sensory … */
  contextKinds: string[];
  /** 谁的事（QQ 号）；空表示不知道归谁 */
  speakerId: string;
  sourceTurnId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AnchorHit {
  anchorId: string;
  name: string;
  kind: AnchorKind;
  alias: string;
  /** 别名与正式目标的等同程度，1.0 = 同一个东西的另一种叫法 */
  confidence: number;
}

export interface ActivationNode {
  anchorId: string;
  name: string;
  kind: AnchorKind;
  score: number;
  hop: number;
  via: string | null;
}

/** 单个候选记忆的打分明细，CLI --json 会原样吐出来，方便调参。 */
export interface ScoreBreakdown {
  /** 线索证据总和（锚点 + 字面 + FTS），相关性闸门用它 */
  evidence: number;
  anchorEvidence: number;
  arousalBonus: number;
  recencyBonus: number;
  tierAccessibility: number;
  pinnedBonus: number;
  total: number;
}

export interface RecallCandidate {
  event: EventRow;
  breakdown: ScoreBreakdown;
}

export interface AffectivePick {
  event: EventRow;
  probability: number;
  /** 抽中的锚点，作为「想到 X 才想起这件事」的锚 */
  viaAnchor: string | null;
}

/**
 * 冷存储地址提示：只占几十个 token，告诉你「这事的地点在 cold://xxx」。
 * 真要细节就显式 deref 一下，不然会白白吃掉上下文。
 */
export interface ColdHint {
  address: string;
  gist: string;
  matchedKeywords: string[];
  eventId: string;
}

export interface DerefResult {
  address: string;
  eventId: string | null;
  gist: string;
  rawDetail: string;
  archivedAt: number;
  /** 这条记忆当前还在主库里吗，在的话给出层级 */
  liveTier: Tier | null;
}

export interface RecallResult {
  query: string;
  seeds: AnchorHit[];
  activation: ActivationNode[];
  /** 事实通道：确定性排序，不允许随机，避免同一问题两种答案 */
  factual: RecallCandidate[];
  /** 情绪通道：概率表 + 随机抽样，只影响语气与联想，不影响事实 */
  probabilityTable: { eventId: string; title: string; probability: number }[];
  affective: AffectivePick | null;
  /** 冷存储地址提示：只给地址和一句话，正文要显式 deref */
  coldHints: ColdHint[];
  mood: { valence: number; arousal: number; label: string } | null;
  contextBlock: string;
  totalTokens: number;
  randomness: { seed: number; temperature: number };
}

export interface SleepStats {
  runId: string;
  turnsIngested: number;
  eventsExtracted: number;
  anchorsTouched: number;
  edgesFormed: number;
  degradedDetailed2Compressed: number;
  degradedCompressed2Fossil: number;
  archived: number;
  mergedFossils: number;
  mergedAnchors: number;
  expiredPins: number;
  deferredPins: number;
  edgesDecayed: number;
  totalTokens: number;
  tiers: Record<Tier, { count: number; tokens: number }>;
  mood: { valence: number; arousal: number; label: string };
  elapsedMs: number;
  /** 被强制叫醒时停在哪一步；正常睡完就没有这个字段 */
  interruptedAtStep?: string;
  /** 用模型抽取时的统计 */
  llm?: {
    days: number;
    inserted: number;
    rejected: number;
    failed: number;
    newAnchors: number;
    reinforced: number;
    frozen: number;
    fallbackDays: string[];
    /** 模型阶段耗时（不含后面的压缩降级） */
    elapsedMs: number;
  };
}

export interface MemoryConfig {
  /**
   * 上下文预算：能被载入上下文的总量，不是磁盘容量。
   * 三层比例都按它算 —— 1M 上下文就有 0.3M 算「最近」。
   */
  contextcontextBudgetTokens: number;
  /** detailed 层占比上限 */
  detailedQuota: number;
  /** compressed 层占比上限，剩下的自然给 fossil */
  compressedQuota: number;
  /** 时间近因权重，刻意设得很低 —— 人类对日期不敏感 */
  recencyWeight: number;
  /** 扩散激活每一跳的衰减 */
  hopDecay: number[];
  maxHops: number;
  tierAccessibility: Record<Tier, number>;
  factTopK: number;
  /** 概率表候选数 */
  probabilisticPool: number;
  temperatureBase: number;
  temperatureArousalGain: number;
  pinnedBonus: number;
  arousalBonus: number;
  /** 低于这个置信度才给出冷存储地址提示 */
  wakeThreshold: number;
  /**
   * 冷存储默认只给地址、不给内容（平时不读取，省 token）。
   * 打开它才会把底片正文直接拼进上下文。
   */
  autoWakeContent: boolean;
  /** 钉住记忆总上限 —— 防「这条很重要」被滥用 */
  pinnedLimit: number;
  /** 每天最多新钉住几条，超出的进待审队列 */
  pinnedDailyLimit: number;
  /** 钉住默认有效期（天），过期自动降级为普通记忆 */
  pinnedTtlDays: number;
  /** 这些模式命中的钉住永不失效（密码、生日这类身份事实） */
  pinPermanentPatterns: string[];
  /** 自动钉住的模式：约定、承诺、密码、偏好 */
  pinPatterns: string[];
  /** 锚点重要度每天衰减系数 */
  salienceDecay: number;
  /** same-as 关系达到这个权重就认为是同一个目标，睡眠时合并节点 */
  identityMergeThreshold: number;
  /**
   * 是否把「推断出来的锚点」也挂到事件上（弱权重 0.35）。
   * 打开能让模糊句子也能被检索到，代价是检索噪声变大——实测会拉低低预算下的召回率。
   */
  bindInferredAnchors: boolean;
  /** 抽取器：heuristic = 词表规则；llm = 调模型 */
  extractor: "heuristic" | "llm";
  /** 本地模型的 OpenAI/Ollama 兼容地址 */
  llmBaseUrl: string;
  llmModel: string;
  llmTimeoutMs: number;
  /**
   * 抽取结果一旦落库就冻结，重跑睡眠不再重抽。
   * 模型有随机性，不冻结会破坏「睡眠幂等」。
   */
  freezeExtractions: boolean;
}


