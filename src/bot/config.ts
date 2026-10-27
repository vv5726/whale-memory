import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface BotConfig {
  // （原注释编码损坏，已清除）
  onebotWs: string;
  // （原注释编码损坏，已清除）
  accessToken: string;
  // （原注释编码损坏，已清除）
  selfId: number;
  // （原注释编码损坏，已清除）
  allowPrivate: number[];
  // （原注释编码损坏，已清除）
  allowGroups: number[];
  /**
   // （原注释编码损坏，已清除）
   // （原注释编码损坏，已清除）
   // （原注释编码损坏，已清除）
   */
  groupReplyMode: "mention" | "all";
  // （原注释编码损坏，已清除）
  extractV3: boolean;
  // （原注释编码损坏，已清除）
  recordGroupChat: boolean;
  // （原注释编码损坏，已清除）
  provider: "ollama" | "deepseek";
  // （原注释编码损坏，已清除）
  ollamaBaseUrl: string;
  ollamaModel: string;
  // （原注释编码损坏，已清除）
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekApiKey: string;
  // （原注释编码损坏，已清除）
  dailyBudgetYuan: number;
  // （原注释编码损坏，已清除）
  costInputPerMTok: number;
  // （原注释编码损坏，已清除）
  costOutputPerMTok: number;
  // （原注释编码损坏，已清除）
  sharedMemory: boolean;
  // （原注释编码损坏，已清除）
  dataDir: string;
  // （原注释编码损坏，已清除）
  adbPath: string;
  // （原注释编码损坏，已清除）
  screenshotDir: string;
  // （原注释编码损坏，已清除）
  toolsEnabled: boolean;
  // （原注释编码损坏，已清除）
  biliSessdata: string;
  // （原注释编码损坏，已清除）
  biliJct: string;
  // （原注释编码损坏，已清除）
  biliDailyWriteLimit: number;
  // （原注释编码损坏，已清除）
  biliDailyVideoQuota: number;
  // （原注释编码损坏，已清除）
  approvalRequired: boolean;
  // （原注释编码损坏，已清除）
  logPort: number;
  // （原注释编码损坏，已清除）
  autonomyEnabled: boolean;
  // （原注释编码损坏，已清除）
  autonomyMinutes: number;
  // （原注释编码损坏，已清除）
  autonomyHours: [number, number];
  // （原注释编码损坏，已清除）
  autonomyIdleMinutes: number;
  // （原注释编码损坏，已清除）
  autonomyDailyRounds: number;
  // （原注释编码损坏，已清除）
  proactiveEnabled: boolean;
  // （原注释编码损坏，已清除）
  proactiveDailyLimit: number;
  // （原注释编码损坏，已清除）
  thinkEnabled: boolean;
  // （原注释编码损坏，已清除）
  // （原注释编码损坏，已清除）
  thinkSettleSeconds: number;
  thinkIdleSeconds: number;
  // （原注释编码损坏，已清除）
  thinkChance: number;
  // （原注释编码损坏，已清除）
  phonePlayEnabled: boolean;
  // （原注释编码损坏，已清除）
  phonePlayChance: number;
  // （原注释编码损坏，已清除）
  proactiveIdleMinutes: number;
  // （原注释编码损坏，已清除）
  memoryDb: string;
  // （原注释编码损坏，已清除）
  contextBudgetTokens: number;
  // （原注释编码损坏，已清除）
  useLlmExtractor: boolean;
  // （原注释编码损坏，已清除）
  sleepForceThreshold: number;
  // （原注释编码损坏，已清除）
  announceSleep: boolean;
  // （原注释编码损坏，已清除）
  idleSleepMinutes: number;
  // （原注释编码损坏，已清除）
  idleSleepHours: number;
  // （原注释编码损坏，已清除）
  dailySleepWindow: [number, number] | null;
  // （原注释编码损坏，已清除）
  dailySleepHour: number | null;
  // （原注释编码损坏，已清除）
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

// （原注释编码损坏，已清除）
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

