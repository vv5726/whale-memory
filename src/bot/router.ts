import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BotService } from "./service.ts";
import { readMind } from "../read-mind.ts";
import type { BotConfig } from "./config.ts";
import type { GroupMember } from "../group-roster.ts";

type ServiceOpts = NonNullable<ConstructorParameters<typeof BotService>[1]>;

/**
 * 按人分流：每个 QQ 号一套独立记忆。
 *
 * 原来整个机器人共用一个库，群里一说话，别人的事就混进「你」的记忆里。
 * 现在每个人的记忆落在 data/users/<QQ号>.db，互不污染。
 *
 * 为什么必须按人隔离：锚点是全局命名空间。共用一个库时，
 * 「我妈」这个锚点下面会同时挂着你的妈妈和朋友的妈妈，检索必然串味。
 */
export class BotRouter {
  private cfg: BotConfig;
  private opts: ServiceOpts;
  private services = new Map<number, BotService>();
  private dir: string;
  /** 生成回复的串行队列 */
  private chain: Promise<unknown> = Promise.resolve();
  /** 已经提示过的群号，避免刷屏 */
  private seenGroups = new Set<number>();
  /** 名册拉取器（bot.ts 注入）：group_members 的 sync 靠它，不然「拿不到 OneBot 连接」 */
  private rosterSource: ((groupId: number) => Promise<GroupMember[]>) | null = null;

  /** 装上名册拉取器：已经在跑的 service 一起装，之后新开的也自动带 */
  setRosterSource(fn: (groupId: number) => Promise<GroupMember[]>): void {
    this.rosterSource = fn;
    for (const s of this.services.values()) s.setRosterSource(fn);
  }

  constructor(cfg: BotConfig, opts: ServiceOpts = {}) {
    this.cfg = cfg;
    this.opts = opts;
    this.dir = join(cfg.dataDir, "users");
    mkdirSync(this.dir, { recursive: true });
  }

  /** 让所有已打开的 service 检查一遍手机 */
  refreshPhones(): void {
    for (const service of this.services.values()) {
      service.refreshPhoneTools();
    }
  }

  private serviceFor(userId: number): BotService {
    const existing = this.services.get(userId);
    if (existing) return existing;

    // 共享记忆：所有人共用一个库（同一个「她」，记同一段人生）
    // 分人隔离：每人一个库（各人的「妈妈」不会串）
    const memoryDb = this.cfg.sharedMemory
      ? join(this.cfg.dataDir, "memory.db")
      : join(this.dir, `${userId}.db`);

    const service = new BotService({ ...this.cfg, memoryDb }, this.opts);
    if (this.rosterSource) service.setRosterSource(this.rosterSource);
    this.services.set(userId, service);
    console.log(
      `[router] 为 ${userId} 打开${this.cfg.sharedMemory ? "共享" : "独立"}记忆库：${memoryDb.replace(this.cfg.dataDir, "data")}`,
    );
    return service;
  }

  async handle(
    evt: { userId: number; isGroup?: boolean; groupId?: number } & Record<string, unknown>,
  ): Promise<string | null> {
    // 群不在白名单：只把群号记下来，不建库、不回复。
    // 你把它拉进群 @ 一次，日志里就会出现群号。
    if (evt.isGroup === true) {
      const gid = Number(evt.groupId ?? 0);
      if (!this.cfg.allowGroups.includes(gid)) {
        if (!this.seenGroups.has(gid)) {
          this.seenGroups.add(gid);
          console.log(`[群] 收到未授权群消息：群号 ${gid}，发言人 ${evt.userId}`);
          console.log("     想启用就把它加进 data/bot.json 的 allowGroups，然后重启");
        }
        return null;
      }
    }

    // 本机只有一个 Ollama 实例，多人同时说话会互相抢显存、谁都慢。
    // 这里排个队：一次只生成一条，后面的人等前面说完。
    // 回话之前先读心：他的潜台词、情绪、我听完的反应。
    // 放在 router 这一层，是因为它拿得到原话和历史，又不用改 service 的结构。
    const task = (async () => {
      const svc = this.serviceFor(evt.userId);
      const text = String((evt as { text?: string }).text ?? "");
      const mind = await readMind(this.cfg.dataDir, text, svc.historyFor(String((evt as { sessionId?: string }).sessionId ?? "")))
        .catch(() => null);
      (evt as { mind?: unknown }).mind = mind;
      return svc.handle(evt as never);
    })();
    this.chain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  /** 处理「准 1234 / 不 1234」：批准了就真的去做 */
  async handleApproval(userId: number, shortId: string, approve: boolean): Promise<string> {
    const service = this.serviceFor(userId);
    const resolved = service.resolveApproval(shortId, approve);
    if (!resolved) return "这个编号我没找到，可能是已经处理过了。";
    if (!approve) return "行，不发了。";

    const toolName =
      resolved.kind === "comment"
        ? "bili_comment"
        : resolved.kind === "danmaku"
          ? "bili_danmaku"
          : resolved.kind === "dynamic"
            ? "bili_dynamic"
            : resolved.kind === "like"
              ? "bili_like"
              : "";
    if (toolName.length === 0) return "这一笔我不知道怎么执行。";

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(resolved.payload || "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }

    const result = await service.callTool(toolName, { ...args, _approved: true });
    if (!result) return "工具没准备好，这次没办成。";
    return result.ok ? `办好了：${result.text}` : `没办成：${result.text}`;
  }

  /** 每个用户的记忆各自按闲置/定点睡觉 */
  startScheduler(intervalMs = 60_000): () => void {
    const timer = setInterval(() => {
      for (const service of this.services.values()) {
        void service.maybeSleep();
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }

  knownUsers(): number[] {
    return [...this.services.keys()];
  }

  close(): void {
    for (const service of this.services.values()) service.close();
    this.services.clear();
  }
}
