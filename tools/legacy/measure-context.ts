/** 量一下凝每次说话真正占多少上下文 */
import { loadBotConfig } from "../src/bot/config.ts";
import { buildTools } from "../src/tools/index.ts";
import { openDb } from "../src/db.ts";
import { recall } from "../src/recall.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { estimateTokens } from "../src/util.ts";

const cfg = loadBotConfig();
const db = openDb("data/users/10001.db");

const tools = buildTools(cfg, db);
const toolsJson = JSON.stringify(tools.schema());
console.log(`工具描述：${tools.names().length} 个工具，${toolsJson.length} 字符 ≈ ${estimateTokens(toolsJson)} token`);

const res = recall(db, DEFAULT_CONFIG, "你还记得今天看了什么吗", { sessionId: "x" });
console.log(`记忆块：${res.contextBlock.length} 字符 ≈ ${estimateTokens(res.contextBlock)} token`);

const watched = db.prepare("SELECT COUNT(*) AS c FROM watched_videos").get() as { c: number };
const events = db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number };
const turns = db.prepare("SELECT COUNT(*) AS c FROM turns").get() as { c: number };
console.log(`库里：${events.c} 条记忆，${watched.c} 个看过，${turns.c} 条原始对话`);

// 历史按代码里 slice(-6) 截断，最多 6 条
const histChars = 6 * 60; // 粗估每条 60 字
console.log(`历史：最多 6 条 ≈ ${estimateTokens("x".repeat(histChars))} token`);

const systemEstimate = 1800; // 人格 + 自我 + 今天 + 额度 + 工具清单
const total = systemEstimate + estimateTokens(res.contextBlock) + estimateTokens(toolsJson) + 120;
console.log(`\n每轮大致：系统 ${systemEstimate} + 记忆 ${estimateTokens(res.contextBlock)} + 工具 ${estimateTokens(toolsJson)} + 历史和问题 ≈ ${total} token`);
console.log(`DeepSeek-chat 上下文窗口 64K，这只占 ${((total / 64000) * 100).toFixed(1)}%`);
