/**
 * QQ 机器人的启动入口。
 *
 * 它只管三件事：把各个部件接起来、起定时器、打日志。
 * 「她怎么想、怎么说」全在 src/bot/service.ts 和 persona.ts 里，这里不碰。
 *
 * 用法：
 *   node src/bot.ts                  正常启动（读 data/bot.json）
 *   node src/bot.ts --init           生成默认配置
 *   node src/bot.ts --status         看当前状态
 *   node src/bot.ts --set-key sk-xx  设 DeepSeek key
 *   node src/bot.ts --say "一句话"    在终端直接跑一轮（调试）
 *   node src/bot.ts --autonomy-once  只跑一次自主活动
 */
import { join } from "node:path";
import { BotService } from "./bot/service.ts";
import { BotRouter } from "./bot/router.ts";
import { setupFileLogging, startLogServer, startLogTruncation } from "./bot/logview.ts";
import { ensureSelfSeed } from "./self.ts";
import { AutonomyLoop } from "./bot/autonomy.ts";
import { describeUptime, markBoot, markDown, markReconnect } from "./uptime.ts";
import { parseApprovalReply } from "./approvals.ts";
import { chooseIdentity, listAvatars, avatarPath } from "./bot/self.ts";
import { OllamaAdapter } from "./llm/adapter.ts";
import { OneBotClient } from "./bot/onebot.ts";
import { configPath, loadBotConfig, saveBotConfig, DEFAULT_BOT_CONFIG } from "./bot/config.ts";
import { openDb, tierTotals } from "./db.ts";
import { pendingTurns } from "./sleep.ts";

function avatarDir(dataDir: string): string {
  return join(dataDir, "avatars");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cfg = loadBotConfig();

  // ── 子命令：生成配置 ──
  if (args.includes("--init")) {
    saveBotConfig(DEFAULT_BOT_CONFIG);
    console.log(`已生成配置：${configPath()}`);
    console.log("接着填 onebotWs / accessToken / allowPrivate / allowGroups / selfId，其余可以先用默认值。");
    return;
  }

  // ── 子命令：设 DeepSeek key（直接写进 JSON，不用手改） ──
  const setKeyIdx = args.indexOf("--set-key");
  if (setKeyIdx >= 0) {
    const key = (args[setKeyIdx + 1] ?? "").trim();
    if (!key.startsWith("sk-") || key.length < 20) {
      console.error("格式不对。用法：node src/bot.ts --set-key sk-xxxxxxxx");
      process.exitCode = 1;
      return;
    }
    saveBotConfig({ ...cfg, deepseekApiKey: key, provider: "deepseek" });
    console.log(`key 已写进 data/bot.json，后端切到 DeepSeek（模型 ${cfg.deepseekModel}）。`);
    console.log(`  key ${key.slice(0, 6)}***　长度 ${key.length}`);
    return;
  }

  // ── 子命令：B 站 cookie ──
  const setJctIdx = args.indexOf("--set-jct");
  if (setJctIdx >= 0) {
    const jct = (args[setJctIdx + 1] ?? "").trim();
    if (jct.length < 20) {
      console.error("格式不对。用法：node src/bot.ts --set-jct <bili_jct>");
      process.exitCode = 1;
      return;
    }
    saveBotConfig({ ...cfg, biliJct: jct });
    console.log(`bili_jct 已保存，长度 ${jct.length}。发评论、点赞要用它。`);
    return;
  }

  const setCookieIdx = args.indexOf("--set-cookie");
  if (setCookieIdx >= 0) {
    const cookie = (args[setCookieIdx + 1] ?? "").trim();
    if (cookie.length < 20) {
      console.error("格式不对。用法：node src/bot.ts --set-cookie <SESSDATA>");
      process.exitCode = 1;
      return;
    }
    saveBotConfig({ ...cfg, biliSessdata: cookie });
    console.log(`B 站 SESSDATA 已保存，长度 ${cookie.length}。`);
    return;
  }

  // ── 子命令：切回本地模型 ──
  if (args.includes("--use-local")) {
    saveBotConfig({ ...cfg, provider: "ollama" });
    console.log(`后端已切回本地 Ollama（模型 ${cfg.ollamaModel}）。`);
    return;
  }

  // ── 子命令：看状态 ──
  if (args.includes("--status")) {
    const db = openDb(cfg.memoryDb);
    const totals = tierTotals(db);
    console.log(`配置：${configPath()}`);
    console.log(`OneBot：${cfg.onebotWs}　本地模型：${cfg.ollamaModel}`);
    console.log(`私聊白名单：${cfg.allowPrivate.join("、") || "（没设，谁都聊不了）"}`);
    console.log(`群白名单：${cfg.allowGroups.join("、") || "（没设，哪个群都不回）"}`);
    console.log(
      `记忆库：${cfg.memoryDb}　事件 ${Object.values(totals).reduce((a, t) => a + t.count, 0)} 条　待整理 ${pendingTurns(db)} 轮`,
    );
    db.close();
    return;
  }

  const service = new BotService(cfg);

  // ── 子命令：让它在 QQ 上自己挑名字和头像（一次性） ──
  if (args.includes("--identity")) {
    const client = new OneBotClient(cfg, () => undefined);
    client.connect();
    try {
      await client.waitReady();
      const me = await client.getLoginInfo();
      const avatars = listAvatars(avatarDir(cfg.dataDir));
      console.log(`当前身份：${me.nickname}（${me.userId}）`);
      console.log(`可选头像：${avatars.length > 0 ? avatars.join("、") : "（data/avatars 里没有图片）"}`);
      console.log("");
      console.log("让它自己选一个名字和头像……");

      const adapter = new OllamaAdapter(cfg.ollamaBaseUrl, cfg.ollamaModel);
      const choice = await chooseIdentity(adapter, {
        currentName: me.nickname,
        avatars,
        recentChat: "",
      });

      console.log(`决定理由：${choice.reason}`);
      if (choice.name === null && choice.avatarFile === null) {
        console.log("它决定不改：现在的名字和头像都还合适。");
      } else {
        if (choice.name !== null) {
          const ok = await client.setSelfNickname(choice.name);
          console.log(`${ok ? "✓" : "✗"} 昵称 → ${choice.name}`);
        }
        if (choice.avatarFile !== null) {
          const ok = await client.setSelfAvatar(avatarPath(avatarDir(cfg.dataDir), choice.avatarFile));
          console.log(`${ok ? "✓" : "✗"} 头像 → ${choice.avatarFile}`);
        }
      }
    } catch (err) {
      console.error(`失败：${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      client.close();
      service.close();
    }
    return;
  }

  // ── 子命令：在终端直接跑一轮（不连 QQ） ──
  const sayIdx = args.indexOf("--say");
  if (sayIdx >= 0) {
    const text = args[sayIdx + 1] ?? "";
    if (text.length === 0) {
      console.error('用法：node src/bot.ts --say "一句话"');
      process.exitCode = 1;
      return;
    }
    const out = await service.say(text);
    console.log("=== 检索到的记忆 ===");
    console.log(out.memory.length > 0 ? out.memory : "（什么都没检索到）");
    console.log("=== 它回的话 ===");
    console.log(out.reply);
    service.close();
    return;
  }

  // 什么都没配的话，别启动
  if (cfg.selfId === 0 && cfg.allowPrivate.length === 0 && cfg.allowGroups.length === 0) {
    console.error("还没配置：先跑 node src/bot.ts --init，然后把 QQ 号和群号填进 data/bot.json");
    process.exitCode = 1;
    service.close();
    return;
  }

  // ── 日志：文件 + 网页 ──
  const logPath = setupFileLogging(join(cfg.dataDir, "logs"));
  // 每小时（整点）清空一次：只留最近一小时，文件不会无限长，
  // read_log / 日志网页就不用每次读几十 MB 的老日志。
  const stopLogTruncation = startLogTruncation(logPath);
  if (cfg.logPort > 0) {
    startLogServer(cfg.logPort, logPath);
    console.log(`[log] 日志网页：http://127.0.0.1:${cfg.logPort}`);
  }
  ensureSelfSeed(cfg.dataDir);

  const ownerId = cfg.allowPrivate[0] ?? cfg.selfId;

  // ── 自主活动用的 service ──
  // 共享一个库：她和主人是同一段人生，不该各记各的。
  const autonomyService = new BotService({
    ...cfg,
    memoryDb: cfg.sharedMemory ? join(cfg.dataDir, "memory.db") : join(cfg.dataDir, "users", `${ownerId}.db`),
  });

  let client: OneBotClient | null = null;
  let lastEvt: Parameters<OneBotClient["reply"]>[0] | null = null;

  const loop = new AutonomyLoop(cfg, autonomyService, (text) => {
    if (client) {
      client.sendPrivate(ownerId, text);
      console.log(`[speak] 主动发给他：${text}`);
    }
  });

  // 手机可能随时断（充电满了自动断 USB），每分钟检查一次
  setInterval(() => {
    try {
      router.refreshPhones();
      autonomyService.refreshPhoneTools();
    } catch {
      // 手机不在就算了，别影响别的
    }
  }, 60_000);

  if (args.includes("--autonomy-once")) {
    const r = await loop.runOnce();
    console.log(r.ran ? `✓ ${r.reason}` : `这次没动：${r.reason}`);
    if (r.text) console.log(`\n${r.text}`);
    autonomyService.close();
    service.close();
    return;
  }

  const router = new BotRouter(cfg, {
    onImage: (p) => {
      if (client && lastEvt) client.sendImage(lastEvt, p);
    },
    notify: (text) => {
      if (client) client.sendPrivate(ownerId, text);
    },
  });

  client = new OneBotClient(cfg, (evt) => {
    lastEvt = evt;
    void (async () => {
      loop.noteUserMessage();

      // 「准 1234 / 不 1234」这类批准回复，先处理掉
      const approval = parseApprovalReply(evt.text);
      if (approval) {
        const answer = await router.handleApproval(evt.userId, approval.shortId, approval.approve);
        if (client) await client.sendBubbles(evt, answer);
        return;
      }

      const reply = await router.handle(evt);
      if (reply) {
        await client.sendBubbles(evt, reply);
        // 说完就结束。以前这里还有一段「回头看要不要再补一句」，
        // 结果它会自问自答、越说越偏，2026-10-26 删掉了。
      }
    })();
  });

  client.connect();
  const stopScheduler = router.startScheduler();
  const stopAutonomy = loop.start();
  const stopSpeaking = cfg.proactiveEnabled ? loop.startSpeaking(1, 20) : () => undefined;
  const stopThinking = cfg.thinkEnabled ? loop.startThinking(1.5, 3.5) : () => undefined;

  // ── 群名册 ──
  // 只学一次：哪个群还没有名册就拉一次存进库，之后不再后台轮询——
  // 名册不是实时数据，没人问就不需要，日志里更不该每半小时刷一行。
  // 要最新的（有人进群/退群）让它自己调 group_members({action:"sync"})。
  const learnRostersOnce = async (): Promise<void> => {
    const c = client;
    if (!c) return;
    const learned: string[] = [];
    for (const gid of cfg.allowGroups) {
      if (autonomyService.hasRoster(gid)) continue;
      try {
        const members = await c.getGroupMemberList(gid);
        if (members.length === 0) continue;
        const r = autonomyService.syncGroupRoster(gid, members);
        learned.push(`群 ${r.group} ${r.count} 人`);
      } catch (err) {
        console.warn(`[roster] 群 ${gid} 拉名册失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (learned.length > 0) console.log(`[roster] 学会名册：${learned.join("，")}（以后不再重复拉）`);
  };
  const rosterTimer = setTimeout(() => void learnRostersOnce(), 5_000);
  // 工具里要现拉时走这个出口
  autonomyService.setRosterSource((gid) => client?.getGroupMemberList(gid) ?? Promise.resolve([]));
  const stopRosters = (): void => clearTimeout(rosterTimer);

  console.log(`[think] 安静 ${cfg.thinkIdleSeconds} 秒后，我可能会忽然想起一件事`);
  console.log(
    `[budget] 每天 ${cfg.dailyBudgetYuan} 元封顶（输入 ${cfg.costInputPerMTok}/M，输出 ${cfg.costOutputPerMTok}/M）`,
  );
  const speakQuota = cfg.proactiveDailyLimit > 0 ? `每天最多 ${cfg.proactiveDailyLimit} 次` : "不限次数";
  console.log(`[speak] 他 ${cfg.proactiveIdleMinutes} 分钟没说话后，我可能会主动找他（${speakQuota}）`);
  console.log(
    `[autonomy] 每 ${cfg.autonomyMinutes} 分钟自己活动一次（${cfg.autonomyHours[0]}-${cfg.autonomyHours[1]} 点）`,
  );

  const backend =
    cfg.provider === "deepseek" ? `DeepSeek API（${cfg.deepseekModel}）` : `本地 Ollama（${cfg.ollamaModel}）`;

  client.onDisconnect = () => markDown(cfg.dataDir);
  client.onReconnect = () => {
    const r = markReconnect(cfg.dataDir);
    if (r.offlineSeconds && r.offlineSeconds > 60) {
      console.log(`[bot] 断线约 ${Math.round(r.offlineSeconds / 60)} 分钟，又接上了`);
    }
  };

  const up = markBoot(cfg.dataDir);
  console.log(`[bot] 起来了。回复后端：${backend}`);
  if (up.crashed) console.log("[bot] 上次是异常退出（没留下告别记录）");

  const sleepParts: string[] = [];
  if (cfg.idleSleepMinutes > 0) sleepParts.push(`聊完 ${cfg.idleSleepMinutes} 分钟整理一次`);
  if (cfg.dailySleepWindow) {
    sleepParts.push(`每天 ${cfg.dailySleepWindow[0]}-${cfg.dailySleepWindow[1]} 点整日整理`);
  }
  console.log(`[sleep] ${sleepParts.join("，") || "空闲时整理"}`);

  const shutdown = (): void => {
    console.log("\n[bot] 关了");
    stopScheduler();
    stopAutonomy();
    stopSpeaking();
    stopThinking();
    stopRosters();
    stopLogTruncation();
    autonomyService.close();
    client?.close();
    router.close();
    service.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

await main();
