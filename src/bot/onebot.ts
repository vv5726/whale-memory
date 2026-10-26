import { toBubbles, bubbleDelay } from "../bubbles.ts";
﻿import { readFileSync } from "node:fs";
import { newId } from "../util.ts";
import type { BotConfig } from "./config.ts";
import type { IncomingMessage } from "./service.ts";

/**
 * OneBot 11 传输层。
 *
 * 只做两件事：把 NapCat 推过来的消息翻译成 IncomingMessage，把回复发回去。
 * 所有「记忆怎么用」的逻辑都在 BotService，这样连不上真 QQ 也能测。
 */
export class OneBotClient {
  private cfg: BotConfig;
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private retry = 0;
  private onMessage: (evt: IncomingMessage) => void;
  /** 等待回执的请求：echo -> resolve */
  private pending = new Map<string, (payload: Record<string, unknown>) => void>();
  /** waitReady 的等待者 */
  private ready: Array<() => void> = [];

  constructor(cfg: BotConfig, onMessage: (evt: IncomingMessage) => void) {
    this.cfg = cfg;
    this.onMessage = onMessage;
  }

  private url(): string {
    const base = this.cfg.onebotWs.replace(/\/$/, "");
    const url = new URL(base);
    if (this.cfg.accessToken.length > 0 && !url.searchParams.has("access_token")) {
      url.searchParams.set("access_token", this.cfg.accessToken);
    }
    return url.toString();
  }

  connect(): void {
    this.closedByUs = false;
    const ws = new WebSocket(this.url());
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.retry = 0;
      console.log(`[onebot] 已连上 ${this.cfg.onebotWs}`);
      for (const resolve of this.ready) resolve();
      this.ready = [];
    });

    ws.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : "";
      if (text.length === 0) return;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }
      // 先看是不是某个请求的回执
      const echo = typeof payload.echo === "string" ? payload.echo : null;
      if (echo !== null && this.pending.has(echo)) {
        const resolve = this.pending.get(echo);
        this.pending.delete(echo);
        resolve?.(payload);
        return;
      }
      const evt = this.toIncoming(payload);
      if (evt) this.onMessage(evt);
    });

    ws.addEventListener("close", () => {
      this.onDisconnect?.();
      if (this.closedByUs) return;
      this.retry += 1;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.retry, 5));
      console.warn(`[onebot] 连接断开，${Math.round(delay / 1000)}s 后重连（第 ${this.retry} 次）`);
      setTimeout(() => this.connect(), delay);
    });

    ws.addEventListener("error", (err) => {
      if (this.closedByUs) return;
      console.error("[onebot] 连接错误:", (err as ErrorEvent).message ?? err);
    });
  }

  /** OneBot 11 事件 → 内部消息；不是消息事件就返回 null */
  private toIncoming(payload: Record<string, unknown>): IncomingMessage | null {
    if (String(payload.post_type) !== "message") return null;
    const userId = Number(payload.user_id ?? 0);
    if (!Number.isFinite(userId) || userId === 0) return null;

    const text = extractText(payload);
    const isGroup = String(payload.message_type) === "group";
    const groupId = isGroup ? Number(payload.group_id ?? 0) : undefined;
    const selfId = Number(payload.self_id ?? this.cfg.selfId);
    // 群里要判断有没有 @ 自己
    const mentioned = Array.isArray(payload.message)
      ? (payload.message as Array<{ type?: string; data?: { qq?: unknown } }>).some(
          (seg) => seg.type === "at" && String(seg.data?.qq) === String(selfId),
        )
      : false;
    const sender = (payload.sender ?? {}) as Record<string, unknown>;
  // 名字三级回退：群名片 → QQ昵称 → QQ<号>。三级都要留着，
  // 只留一个字符串的话，下游就没法知道「是没设名片，还是根本没拿到昵称」。
  const senderFields = {
    userId: Number(sender.user_id ?? userId) || userId,
    card: String(sender.card ?? "").trim(),
    nickname: String(sender.nickname ?? "").trim(),
    role: String(sender.role ?? ""),
  };
    const nick = String(sender.card ?? sender.nickname ?? "").trim();
    const userName = nick.length > 0 ? nick : `QQ${userId}`;

    return {
      sessionId: isGroup ? `group:${groupId}:user:${userId}` : `private:${userId}`,
      userId,
      userName,
      // 原始 sender：名片 / 昵称 / 群内角色。压成一个字符串的话，
      // 下游就没法做三级回退，也认不出「同一个人换名片」。
      sender: senderFields,
      text,
      isGroup,
      groupId,
      mentioned,
      selfId,
    };
  }

  sendPrivate(userId: number, text: string): void {
    this.send({ action: "send_private_msg", params: { user_id: userId, message: text }, echo: newId("echo") });
  }

  sendGroup(groupId: number, text: string): void {
    this.send({ action: "send_group_msg", params: { group_id: groupId, message: text }, echo: newId("echo") });
  }

  reply(evt: IncomingMessage, text: string): void {
    if (evt.isGroup && evt.groupId !== undefined) this.sendGroup(evt.groupId, text);
    else this.sendPrivate(evt.userId, text);
  }

  /**
   * 一条话分几口气发出去。
   *
   * 一次扔一整段像邮件；拆成两三条、中间停半秒到一秒，才像人在打字。
   */
  async sendBubbles(evt: IncomingMessage, text: string): Promise<void> {
    const bubbles = toBubbles(text);
    for (let i = 0; i < bubbles.length; i += 1) {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, bubbleDelay(bubbles[i - 1]!)));
      }
      this.reply(evt, bubbles[i]!);
    }
  }

  /** 断线 / 重连时通知外面（用来记「我离线了多久」） */
  onDisconnect?: () => void;
  onReconnect?: () => void;

  /**
   * 群成员名册（OneBot 11：get_group_member_list）。
   * 有了它它才知道群里除了说过话的那几个人还有谁。
   */
  async getGroupMemberList(groupId: number): Promise<GroupMember[]> {
    const res = await this.request("get_group_member_list", { group_id: groupId }, 20_000);
    return parseMemberList(res.data);
  }

  private send(action: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[onebot] 还没连上，消息没发出去");
      return;
    }
    this.ws.send(JSON.stringify(action));
  }

  /** 等连接建立（命令行里要用，不能一直挂着） */
  waitReady(timeoutMs = 15_000): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("连接超时")), timeoutMs);
      this.ready.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** 发一个需要等回执的动作（查资料、改昵称这类） */
  request(action: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("还没连上 OneBot"));
        return;
      }
      const echo = newId("req");
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`请求超时：${action}`));
      }, timeoutMs);
      this.pending.set(echo, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      this.ws.send(JSON.stringify({ action, params, echo }));
    });
  }

  /** 机器人自己的资料 */
  async getLoginInfo(): Promise<{ userId: number; nickname: string }> {
    const res = await this.request("get_login_info");
    const data = (res.data ?? {}) as Record<string, unknown>;
    return { userId: Number(data.user_id ?? 0), nickname: String(data.nickname ?? "") };
  }

  /** 发一张本地图片（转 base64，NapCat 与机器人同机时最稳） */
  sendImage(evt: IncomingMessage, filePath: string): void {
    let buf: Buffer;
    try {
      buf = readFileSync(filePath);
    } catch (err) {
      console.warn(`[onebot] 读不到图片 ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const b64 = buf.toString("base64");
    const action =
      evt.isGroup && evt.groupId
        ? { action: "send_group_msg", params: { group_id: evt.groupId, message: [{ type: "image", data: { file: `base64://${b64}` } }] } }
        : { action: "send_private_msg", params: { user_id: evt.userId, message: [{ type: "image", data: { file: `base64://${b64}` } }] } };
    this.send(action);
    console.log(`[onebot] 发了一张图（${Math.round(buf.length / 1024)} KB）`);
  }

  /** 改自己的 QQ 昵称 */
  async setSelfNickname(nickname: string): Promise<boolean> {
    const res = await this.request("set_qq_profile", { nickname });
    return String(res.status) === "ok" || Number(res.retcode) === 0;
  }

  /** 改自己的头像（本地文件路径，NapCat 与本机同机时可用） */
  async setSelfAvatar(filePath: string): Promise<boolean> {
    const res = await this.request("set_qq_avatar", { file: filePath }, 30_000);
    return String(res.status) === "ok" || Number(res.retcode) === 0;
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
  }
}

/** OneBot 群成员 → 我们要的形状（可单独测） */
export interface GroupMember {
  qqId: string;
  /** 群名片（优先） */
  card: string;
  nickname: string;
  role: string;
}

export function parseMemberList(data: unknown): GroupMember[] {
  if (!Array.isArray(data)) return [];
  const out: GroupMember[] = [];
  for (const raw of data) {
    const m = raw as Record<string, unknown>;
    const qqId = String(m.user_id ?? m.qq ?? "").trim();
    if (!/^\d{3,}$/.test(qqId)) continue;
    out.push({
      qqId,
      card: String(m.card ?? "").trim(),
      nickname: String(m.nickname ?? "").trim(),
      role: String(m.role ?? "member"),
    });
  }
  return out;
}

/** OneBot 消息段 → 纯文本（去掉 @、图片等非文本段） */
export function extractText(payload: Record<string, unknown>): string {
  const segments = payload.message;
  if (Array.isArray(segments)) {
    const parts: string[] = [];
    for (const seg of segments) {
      const s = seg as { type?: string; data?: Record<string, unknown> };
      // ★ 以前只收 text，图片段被直接丢掉——那她当然永远只看到占位符。
      if (s.type === "text") {
        parts.push(String(s.data?.text ?? ""));
      } else if (s.type === "image") {
        // 原样拼成 CQ 码，带上 url，后面交给「眼睛」去描述
        const file = String(s.data?.file ?? "");
        const url = String(s.data?.url ?? "");
        const summary = String(s.data?.summary ?? "").replace(/[,\]]/g, " ");
        parts.push(`[CQ:image,file=${file},url=${encodeURIComponent(url)},summary=${summary}]`);
      } else if (s.type === "face") {
        parts.push(`[CQ:face,id=${String(s.data?.id ?? "")}]`);
      } else if (s.type === "at") {
        parts.push(`[CQ:at,qq=${String(s.data?.qq ?? "")}]`);
      } else if (s.type === "record") {
        parts.push("[CQ:record]");
      }
    }
    if (parts.length > 0) return parts.join("").trim();
  }
  return String(payload.raw_message ?? "").trim();
}
