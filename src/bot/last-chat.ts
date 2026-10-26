/**
 * 「刚才在跟谁说话」——模块级共享，跨 service 实例。
 *
 * 为什么要全局：聊天走的是 router 按用户分的 service 实例（每个 QQ 一个），
 * 而走神/自主活动挂在另一个实例上。以前走神想说话时不知道自己刚才在哪儿聊，
 * 于是 onSpeak 无条件发主人私聊——结果就是：群里在跟别人聊，话却发到了主人那儿。
 */
export interface ChatTarget {
  isGroup: boolean;
  groupId?: number;
  userId: number;
  userName: string;
  at: number;
}

let recent: ChatTarget[] = [];

/** 同一个会话只留最新一条；最多留 3 个 */
export function noteChatTarget(t: Omit<ChatTarget, "at">): void {
  const key = t.isGroup && t.groupId ? `group:${t.groupId}` : `private:${t.userId}`;
  recent = [{ ...t, at: Date.now() }, ...recent.filter((x) => (x.isGroup && x.groupId ? `group:${x.groupId}` : `private:${x.userId}`) !== key)].slice(0, 3);
}

/** 最近的几个会话（新的在前），超过 maxAgeMs 的丢掉 */
export function recentChatTargets(maxAgeMs = 15 * 60_000, now = Date.now()): ChatTarget[] {
  return recent.filter((x) => now - x.at <= maxAgeMs);
}

export function resetChatTargets(): void {
  recent = [];
}

/** 最近的会话；超过 maxAgeMs 就当作"没有"（避免拿一小时后的事接着聊） */
export function lastChatTarget(maxAgeMs = 15 * 60_000, now = Date.now()): ChatTarget | null {
  return recentChatTargets(maxAgeMs, now)[0] ?? null;
}

export function lastChatTargetRaw(): ChatTarget | null {
  return recent[0] ?? null;
}

/** 把「给：…」里的说法解析成目标：QQ 号 / 群号 / 名字 / 群里@名字 */
export function matchChatTarget(spoken: string, targets: ChatTarget[]): ChatTarget | null {
  const t = String(spoken ?? "").trim();
  if (t.length === 0) return null;
  const nums = (t.match(/\d{5,}/g) ?? []).map(Number);
  for (const n of nums) {
    // 先当群号找；找不到再当人找——私聊就发给他本人，
    // 如果这个人只在某个群里说过话，就说回那个群（「跟她说」的语义）
    const byGroup = targets.find((x) => x.isGroup && x.groupId === n);
    if (byGroup) return byGroup;
    const byPrivate = targets.find((x) => !x.isGroup && x.userId === n);
    if (byPrivate) return byPrivate;
    const byPersonInGroup = targets.find((x) => x.isGroup && x.userId === n);
    if (byPersonInGroup) return byPersonInGroup;
  }
  for (const x of targets) {
    if (x.userName && t.includes(x.userName)) return x;
  }
  if (/群/.test(t)) {
    const g = targets.find((x) => x.isGroup && x.groupId);
    if (g) return g;
  }
  return null;
}

/** 发消息的目标：有最近会话就发那儿，否则发主人私聊 */
export interface SpeakTarget {
  kind: "group" | "private";
  id: number;
  label: string;
}

export function resolveSpeakTarget(target: ChatTarget | null, ownerId: number): SpeakTarget {
  if (target) {
    if (target.isGroup && target.groupId) {
      return { kind: "group", id: target.groupId, label: `群 ${target.groupId}` };
    }
    return { kind: "private", id: target.userId, label: `${target.userName || target.userId}（私聊）` };
  }
  return { kind: "private", id: ownerId, label: "主人私聊" };
}
