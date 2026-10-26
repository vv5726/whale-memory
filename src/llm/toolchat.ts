import { recordUsage } from "../cost.ts";
import { injectPendingImages } from "../bot/pending-images.ts";
import { coerceArgs, type ToolRegistry } from "../tools/registry.ts";

export interface ToolChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 说话的温度；不传就用 0 */
  temperature?: number;
  timeoutMs?: number;
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface ToolChatResult {
  text: string;
  /** 这一轮调用了哪些工具（给日志和调试用） */
  calls: Array<{ name: string; args: Record<string, unknown>; ok: boolean; result: string }>;
}

/**
 * 带工具调用的一轮对话。
 *
 * 流程：发给模型 → 它要调工具 → 我们执行 → 结果塞回去 → 再问一次。
 *
 * **轮次默认不限**（maxRounds <= 0）：跑到模型自己不再调工具为止。
 * 以前的 4 轮上限是怕它死循环，但它常常是真的还有事要办——
 * 「开个 App、读一屏」就自动收尾，活干到一半。真正的刹车是每日预算和单次超时。
 * 只在「不限」模式下留一个很高的硬顶（HARD_ROUND_CAP）兜住真的死循环。
 */
const HARD_ROUND_CAP = 999;

export async function runChatWithTools(
  cfg: ToolChatConfig,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  registry: ToolRegistry,
  maxRounds = 0,
): Promise<ToolChatResult> {
  // 这一轮如果挂着原图（她刚收到图），注入到最后一条 user 消息里；注入一次就清空
  const withImages = injectPendingImages(
    messages as Array<{
      role: string;
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    }>,
  );
  const history: OpenAiMessage[] = withImages.map((m) => ({ role: m.role, content: m.content as OpenAiMessage["content"] }));
  // 累计这一整轮的用量，交给记账
  let promptTokens = 0;
  let cacheHit = 0;
  let cacheMiss = 0;
  let completionTokens = 0;
  const calls: ToolChatResult["calls"] = [];
  const tools = registry.schema();
  const unlimited = !(maxRounds > 0);
  const limit = unlimited ? HARD_ROUND_CAP : Math.max(1, Math.floor(maxRounds));

  for (let round = 0; round < limit; round += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 60_000);
    let payload: {
      usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_cache_hit_tokens?: number;
      prompt_cache_miss_tokens?: number;
    };
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: OpenAiMessage["tool_calls"] };
        finish_reason?: string;
      }>;
    };
    try {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, messages: history, tools, tool_choice: "auto", temperature: 0 }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
      }
      payload = (await res.json()) as typeof payload;
      promptTokens += Number(payload.usage?.prompt_tokens ?? 0);
      completionTokens += Number(payload.usage?.completion_tokens ?? 0);
    } finally {
      clearTimeout(timer);
    }

    const message = payload.choices?.[0]?.message;
    const toolCalls = message?.tool_calls ?? [];

    if (toolCalls.length === 0) {
      recordUsage(promptTokens, completionTokens, cacheHit, cacheMiss);
      return { text: (message?.content ?? "").trim(), calls };
    }

    // 把模型这一轮的“我想调工具”记进历史
    history.push({ role: "assistant", content: message?.content ?? null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      const name = call.function?.name ?? "";
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function?.arguments ?? "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      const schema = registry.schema().find((t) => t.function.name === name)?.function.parameters ?? {};
      const result = await registry.call(name, coerceArgs(args, schema));
      calls.push({ name, args, ok: result.ok, result: result.text });
      console.log(`[tool] ${name}(${JSON.stringify(args)}) → ${result.text.slice(0, 80)}`);
      history.push({ role: "tool", tool_call_id: call.id, content: result.text });
    }
  }

  // 轮次用尽：让它就现有信息收个尾
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 60_000);
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          ...history,
          {
            role: "user",
            content:
              "（系统提示：这次的工具调用轮次到上限了。用你手上已有的信息给出结果，不要再调工具。这句话不是你对面那个人说的。）",
          },
        ],
        temperature: cfg.temperature ?? 0,
      }),
    });
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const tail = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number } }).usage;
    recordUsage(promptTokens + Number(tail?.prompt_tokens ?? 0), completionTokens + Number(tail?.completion_tokens ?? 0));
    return { text: (data.choices?.[0]?.message?.content ?? "").trim(), calls };
  } finally {
    clearTimeout(timer);
  }
}
