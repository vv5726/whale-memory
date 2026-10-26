import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface BotConfig {
  /** OneBot 11 的 WebSocket 地址（NapCat 里配的「WebSocket 服务器」） */
  onebotWs: string;
  /** NapCat 里配的 token，没有就留空 */
  accessToken: string;
  /** 机器人自己的 QQ 号，用来过滤自己发的消息 */
  selfId: number;
  /** 允许私聊的 QQ 号；空数组表示谁都不理 */
  allowPrivate: number[];
  /** 允许群聊的群号；空数组表示群里不理 */
  allowGroups: number[];
  /**
   * 群里的说话方式：
   *  - mention：只在被 @ 时开口（默认，防刷屏）
   *  - all：群里每条都回（会很吵，也不利于 GPU）
   */
  groupReplyMode: "mention" | "all";
  /** 新版三仓抽取：events / lexicon / persons */
  extractV3: boolean;
  /** 群里没 @ 它的话要不要也记进那个人的记忆（默认不记，别偷听） */
  recordGroupChat: boolean;
  /** 回复用哪个后端：本地 Ollama，还是 DeepSeek 官方 API */
  provider: "ollama" | "deepseek";
  /** 回复用的本地模型 */
  ollamaBaseUrl: string;
  ollamaModel: string;
  /** DeepSeek 官方 API（OpenAI 兼容） */
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekApiKey: string;
  /** 每天最多花多少钱（元）；0 表示不限。这是唯一还拦着她的东西 */
  dailyBudgetYuan: number;
  /** 每百万输入 token 多少钱 */
  costInputPerMTok: number;
  /** 每百万输出 token 多少钱 */
  costOutputPerMTok: number;
  /** 所有人共用一个记忆库（data/memory.db），而不是每人一个 */
  sharedMemory: boolean;
  /** 记忆库根目录（分人模式下落在 <dataDir>/users/<QQ号>.db） */
  dataDir: string;
  /** adb 可执行文件路径 */
  adbPath: string;
  /** 手机截图存放目录 */
  screenshotDir: string;
  /** 是否开放工具（时间、手机控制、B站） */
  toolsEnabled: boolean;
  /** B站登录后的 SESSDATA，填了才能读字幕；留空只能看热门和简介 */
  biliSessdata: string;
  /** B站登录后的 bili_jct（CSRF token），填了才能点赞/评论/发弹幕/发动态 */
  biliJct: string;
  /** 每天最多做几次写操作（点赞+评论+弹幕+动态合计），防跑飞 */
  biliDailyWriteLimit: number;
  /** 每天能看几个视频（读字幕算一次）；额度用完就等明天 */
  biliDailyVideoQuota: number;
  /** 评论/弹幕/动态发出去之前，要不要先问本人 */
  approvalRequired: boolean;
  /** 日志网页端口（http://127.0.0.1:<端口>），0 表示不开 */
  logPort: number;
  /** 没人找它的时候，它自己活动吗 */
  autonomyEnabled: boolean;
  /** 隔多少分钟活动一次 */
  autonomyMinutes: number;
  /** 允许活动的时段 [起, 止)，支持跨午夜 */
  autonomyHours: [number, number];
  /** 刚聊过多久之内不活动（分钟），别打断人 */
  autonomyIdleMinutes: number;
  /** 每天最多自主活动几轮 */
  autonomyDailyRounds: number;
  /** 会不会自己开口找他（不是回复，是主动发起） */
  proactiveEnabled: boolean;
  /** 每天最多主动说几次；0 表示不限 */
  proactiveDailyLimit: number;
  /** 没人说话时会不会「走神」：随机想起一个锚点，自己琢磨 */
  thinkEnabled: boolean;
  /** 安静多少秒之后才允许走神 */
  /** 刚干完事多少秒内不走神（避免打断手上的事） */
  thinkSettleSeconds: number;
  thinkIdleSeconds: number;
  /** 每次走神掷中的概率 */
  thinkChance: number;
  /** 自主活动时会不会偶尔去玩手机 */
  phonePlayEnabled: boolean;
  /** 每次活动掷到「玩手机」的概率 */
  phonePlayChance: number;
  /** 他多久没说话之后才允许主动开口（分钟） */
  proactiveIdleMinutes: number;
  /** 记忆库路径（单用户模式用；路由器模式下由 dataDir 决定） */
  memoryDb: string;
  /** 上下文预算（token） */
  contextBudgetTokens: number;
  /** 睡觉时用不用模型抽取（关掉就退回词表规则，快但糙） */
  useLlmExtractor: boolean;
  /** 待整理对话攒到多少条就强制睡一觉（不管在不在聊） */
  sleepForceThreshold: number;
  /** 睡觉前要不要跟人说一声「困了」 */
  announceSleep: boolean;
  /** 说话停下几分钟后就整理一次记忆（分钟）。这是主要的触发方式，0 表示关 */
  idleSleepMinutes: number;
  /** 更长的闲置后彻底整理一次（小时）。0 表示不用 */
  idleSleepHours: number;
  /** 每天在哪个时段整理（[起, 止)，24 小时制）；null 表示不用 */
  dailySleepWindow: [number, number] | null;
  /** 每天固定几点睡一次（0-23），null 表示不定时 */
  dailySleepHour: number | null;
  /** 不给陌生人回复时的提示 */
  strangerReply: string;
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  onebotWs: "ws://127.0.0.1:3001",
  accessToken: "",
  selfId: 0,
  allowPrivate: [],
  allowGroups: [],
  groupReplyMode: "mention",
  extractV3: false,
  recordGroupChat: false,
  provider: "ollama",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen3:8b",
  deepseekBaseUrl: "https://api.deepseek.com/v1",
  deepseekModel: "deepseek-chat",
  deepseekApiKey: "",
  dataDir: join(ROOT, "data"),
  dailyBudgetYuan: 5,
  costInputPerMTok: 2,
  costOutputPerMTok: 8,
  sharedMemory: true,
  adbPath: "C:\\platform-tools\\adb.exe",
  screenshotDir: join(ROOT, "data", "screenshots"),
  toolsEnabled: true,
  biliSessdata: "",
  biliJct: "",
  biliDailyWriteLimit: 0,
  biliDailyVideoQuota: 0,
  approvalRequired: false,
  logPort: 3211,
  autonomyEnabled: true,
  autonomyMinutes: 20,
  autonomyHours: [9, 24],
  autonomyIdleMinutes: 8,
  autonomyDailyRounds: 24,
  proactiveEnabled: true,
  proactiveDailyLimit: 0,
  thinkEnabled: true,
  thinkSettleSeconds: 90,
  thinkIdleSeconds: 30,
  thinkChance: 0.55,
  phonePlayEnabled: true,
  phonePlayChance: 0.35,
  proactiveIdleMinutes: 45,
  memoryDb: join(ROOT, "data", "qq-memory.db"),
  contextBudgetTokens: 200_000,
  useLlmExtractor: true,
  sleepForceThreshold: 50,
  announceSleep: true,
  idleSleepMinutes: 3,
  idleSleepHours: 12,
  dailySleepWindow: [3, 5],
  dailySleepHour: null,
  strangerReply: "",
};

export function configPath(): string {
  return join(ROOT, "data", "bot.json");
}

/** 去掉 BOM：PowerShell / 记事本写的 UTF-8 常带 BOM，JSON.parse 会直接报错 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function loadBotConfig(): BotConfig {
  const path = configPath();
  if (!existsSync(path)) {
    saveBotConfig(DEFAULT_BOT_CONFIG);
    return { ...DEFAULT_BOT_CONFIG };
  }
  const raw = JSON.parse(stripBom(readFileSync(path, "utf8"))) as Partial<BotConfig>;
  return { ...DEFAULT_BOT_CONFIG, ...raw };
}

export function saveBotConfig(cfg: BotConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
}

