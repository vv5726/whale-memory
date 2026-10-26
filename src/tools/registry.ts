/**
 * 工具注册表。
 *
 * 设计原则：
 *  1. 每个工具自己声明 JSON Schema——模型靠这个知道怎么调，不靠我们描述。
 *  2. 工具返回**一行短文本**，不要塞大段数据进上下文（截图尤其不能整张塞）。
 *  3. 任何工具出错都不许抛到对话层，返回一句人话让模型自己决定怎么办。
 */
export interface ToolResult {
  ok: boolean;
  /** 给模型看的结果，尽量短 */
  text: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema：{"type":"object","properties":{...},"required":[...]} */
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

import { acquireDevice } from "../device-lock.ts";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /** 按前缀摘掉一批（比如手机拔了，把 phone_* 全摘掉） */
  removePrefix(prefix: string): string[] {
    const removed: string[] = [];
    for (const name of [...this.tools.keys()]) {
      if (name.startsWith(prefix)) {
        this.tools.delete(name);
        removed.push(name);
      }
    }
    return removed;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** 给模型看的工具清单（OpenAI function calling 格式） */
  schema(): Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    return [...this.tools.values()].map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * 取一个子集。
   *
   * 给「阅读员」用：它只需要能读的工具，不能被挂上
   * 点赞/评论/发动态——那是主对话才该做的决定。
   */
  subset(names: string[]): ToolRegistry {
    const sub = new ToolRegistry();
    for (const n of names) {
      const t = this.tools.get(n);
      if (t) sub.register(t);
    }
    return sub;
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, text: `没有叫 ${name} 的工具` };

    // 手机和对外写操作要排队：聊天和思考是两个 service，
    // 不锁就会两边同时点手机，谁都以为自己在正确的位置。
    const needsDevice = /^phone_/.test(name) || /^bili_(like|comment|danmaku|dynamic)$/.test(name);
    let release: (() => void) | null = null;
    if (needsDevice) {
      try {
        release = await acquireDevice(60_000);
      } catch {
        return { ok: false, text: "设备正被别的动作占着，这次先不动它" };
      }
    }

    try {
      return await tool.handler(args);
    } catch (err) {
      return { ok: false, text: `${name} 执行失败：${err instanceof Error ? err.message : String(err)}` };
    } finally {
      release?.();
    }
  }
}

/** 把参数按 schema 里声明的类型粗转换一次（模型常把数字发成字符串） */
export function coerceArgs(args: Record<string, unknown>, schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, { type?: string }>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const type = props[key]?.type;
    if (type === "number" || type === "integer") {
      const n = Number(value);
      out[key] = Number.isFinite(n) ? (type === "integer" ? Math.round(n) : n) : value;
    } else if (type === "boolean") {
      out[key] = value === true || value === "true";
    } else {
      out[key] = value;
    }
  }
  return out;
}
