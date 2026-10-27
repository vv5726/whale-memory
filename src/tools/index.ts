import { execFileSync } from "node:child_process";
import { ToolRegistry } from "./registry.ts";
import { registerBasicTools } from "./basic.ts";
import { registerPhoneGuide, registerPhoneTools } from "./phone.ts";
import { registerBiliTools } from "./bili.ts";
import { registerSelfTools } from "./self.ts";
import { registerLogTools } from "./logs.ts";
import { registerPersonaTools } from "./persona.ts";
import { registerToolAuditTools } from "./tool-audit.ts";
import { registerStickerTools } from "./stickers.ts";
import { registerThinkTools } from "./think.ts";
import { registerPlanTools } from "./plans.ts";
import { registerDataFileTools } from "./datafiles.ts";
import { registerSocialTools } from "./social.ts";
import { registerImpressionTools } from "./impression.ts";
import { registerImpressionWeightTool } from "../impressions.ts";
import { registerMemeTools } from "./memes.ts";
import { registerRosterTools } from "./roster.ts";
import { registerJournalTools } from "./journal.ts";
import { registerSelfMemoryTools } from "./selfmemory.ts";
import { registerKbTools } from "./kb.ts";
import { registerMentorTools } from "./mentor.ts";
import { registerSettleTool } from "../settle-score.ts";
import { registerTuneTool } from "../tune-tool.ts";
import { registerForgetTool } from "../forget.ts";
import { registerPinTool } from "../pin.ts";
import { registerAboutPersonTool } from "../about-person.ts";
import { registerListTool, listMemories } from "../list-memories.ts";
import { registerExtractRulesTools } from "./extract-rules.ts";
import { registerSourceTools } from "./source.ts";
import { registerSayTools } from "./say.ts";
import { registerFeelTools } from "./feel.ts";
import { registerDedupTool, dedupMemories } from "../dedup.ts";
import { registerVisionTools } from "./vision.ts";
import { registerSpeechTools } from "./speech.ts";
import { registerVerifyTools } from "./verify.ts";
import { registerMergeTool, mergeMemories } from "../merge-dedup.ts";
import { registerGroupPolicyTools } from "./group-policy.ts";
import { registerSelfStatusTools } from "./self-status.ts";
import { dayKey } from "../util.ts";
import type { DatabaseSync } from "node:sqlite";
import type { BotConfig } from "../bot/config.ts";

// （原注释编码损坏，已清除）
function hasDevice(adbPath: string): boolean {
  try {
    const out = execFileSync(adbPath, ["devices"], { timeout: 8000, encoding: "utf8" });
    return out
      .split(/\r?\n/)
      .slice(1)
      .some((l) => l.trim().endsWith("\tdevice"));
  } catch {
    return false;
  }
}

/**
 // （原注释编码损坏，已清除）
 *
 * ???**??????????????**??
 // （原注释编码损坏，已清除）
 * ????????????????????????????
 // （原注释编码损坏，已清除）
 */
export function buildTools(
  cfg: BotConfig,
  db?: DatabaseSync,
  notify?: (text: string) => void,
  memoryHooks?: {
    save?: (text: string) => { ok: boolean; text: string };
    tidy?: () => Promise<{ ok: boolean; text: string }>;
    learn?: (term: string, meaning: string) => boolean;
    lookup?: (term: string) => string | undefined;
    kbAdd?: (input: { category: string; title: string; content: string; source?: string }) => { ok: boolean; text: string };
    kbSearch?: (query: string) => Array<{ category: string; title: string; content: string; source?: string }>;
    kbList?: () => Array<{ category: string; count: number }>;
    kbLink?: (title: string, anchor: string, remove?: boolean) => boolean;
    mentorAsk?: (question: string, context?: string) => { ok: boolean; text: string };
    mentorReplies?: () => Array<{ answer: string }>;
    settle?: (threshold: number) => import("../settle-score.ts").SettleResult;
    pin?: (input: { id?: string; title?: string; pin: boolean; expireDays?: number }) => { ok: boolean; text: string };
    about?: (input: { person: string; content: string }) => { ok: boolean; text: string };
    listMemories?: (opts: { limit?: number; kind?: string; sinceDays?: number }) => { rows: Array<{ id: string; title: string; kind: string; tier: string; day: string; pinned: boolean }>; total: number };
    /** 发一张本地图片到当前对话（表情包用）；没有正在聊的对话时不传 */
    sendSticker?: (filePath: string) => void | Promise<void>;
    /** 拉真实好友列表（can_dm action=sync 用） */
    listFriends?: () => Promise<number[]>;
    /** 群名册按需刷新（group_members 的 action=sync）；拿不到 OneBot 连接时返回 null */
    rosterRefresh?: (groupId: number) => Promise<number | null>;
    /** 把一句话真的发出去（say_to 工具用）：target 可以是群号、人名，留空发最近的会话 */
    deliverText?: (text: string, target?: string) => Promise<{ ok: boolean; text: string }>;
  },
): ToolRegistry {
  const registry = new ToolRegistry();
  registerBasicTools(registry);

  const phoneReady = hasDevice(cfg.adbPath);
  if (phoneReady) {
    registerPhoneTools(registry, { adbPath: cfg.adbPath, shotDir: cfg.screenshotDir });
    registerPhoneGuide(registry);
  }

  registerBiliTools(registry, {
    sessdata: cfg.biliSessdata,
    jct: cfg.biliJct,
    dailyWriteLimit: cfg.biliDailyWriteLimit,
    videoQuota: cfg.biliDailyVideoQuota,
    db,
    approvalRequired: cfg.approvalRequired,
    notify,
  });

  registerSelfTools(registry, cfg.dataDir);
  registerPersonaTools(registry, cfg.dataDir);
  registerToolAuditTools(registry, { dataDir: cfg.dataDir });
  registerMemeTools(registry, { dataDir: cfg.dataDir });
  registerStickerTools(registry, { db, dataDir: cfg.dataDir, send: memoryHooks?.sendSticker });
  registerThinkTools(registry, { dataDir: cfg.dataDir });
  registerDataFileTools(registry, { dataDir: cfg.dataDir });
  if (db) registerSocialTools(registry, { db, listFriends: memoryHooks?.listFriends });
  if (db) registerImpressionTools(registry, { db });
  if (db) registerImpressionWeightTool(registry, { db });
  if (db) registerPlanTools(registry, { db, dataDir: cfg.dataDir });
  registerLogTools(registry, cfg.dataDir);
  if (db) registerSelfMemoryTools(registry, db, memoryHooks);
  if (db) registerRosterTools(registry, { db, refresh: memoryHooks?.rosterRefresh });
  registerTuneTool(registry, memoryHooks);
  if (db && memoryHooks) registerForgetTool(registry, memoryHooks);
  if (db && memoryHooks) registerPinTool(registry, memoryHooks);
  if (db && memoryHooks) registerAboutPersonTool(registry, memoryHooks);
  if (db) registerListTool(registry, memoryHooks ?? { listMemories: (o) => listMemories(db, o) });
  registerExtractRulesTools(registry, { dataDir: cfg.dataDir });
  registerSourceTools(registry);
  registerSayTools(registry, { deliver: memoryHooks?.deliverText });
  if (db) registerFeelTools(registry, { db });
  // 去重已停用：不再做破坏性归档
  registerVisionTools(registry);
  registerSpeechTools(registry, { dataDir: cfg.dataDir });
  registerVerifyTools(registry, { dataDir: cfg.dataDir });
  // （原注释编码损坏，已清除）
  registerGroupPolicyTools(registry, {
    dataDir: cfg.dataDir,
    defaultMode: cfg.groupReplyMode,
    allowGroups: cfg.allowGroups ?? [],
  });
  if (memoryHooks) registerSettleTool(registry, { settle: memoryHooks.settle });
  if (memoryHooks) registerKbTools(registry, { add: memoryHooks.kbAdd, search: memoryHooks.kbSearch, list: memoryHooks.kbList, link: memoryHooks.kbLink });
  registerJournalTools(registry, cfg.dataDir, () => dayKey(Date.now()), db);
  if (db) registerSelfStatusTools(registry, { db, dataDir: cfg.dataDir });

  if (!phoneReady) {
    console.log("[tools] 手机连上了，手机工具已挂上");
  }
  return registry;
}

// （原注释编码损坏，已清除）
export function attachPhoneTools(registry: ToolRegistry, cfg: BotConfig): boolean {
  if (!hasDevice(cfg.adbPath)) return false;
  if (registry.names().some((n) => n.startsWith("phone_"))) return true;
  registerPhoneTools(registry, cfg);
  registerPhoneGuide(registry);
  return true;
}

// （原注释编码损坏，已清除）
export function detachPhoneTools(registry: ToolRegistry): string[] {
  return registry.removePrefix("phone_");
}
