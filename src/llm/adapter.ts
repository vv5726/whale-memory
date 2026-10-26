import { readFileSync } from "node:fs";
import type { MemoryConfig } from "../types.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  /** 要求模型只输出 JSON */
  json?: boolean;
  timeoutMs?: number;
}

export interface LlmAdapter {
  name: string;
  complete(messages: ChatMessage[], opts?: CompleteOptions): Promise<string>;
}

/**
 * Ollama 适配器。
 *
 * 之所以选 Ollama 而不是直接调 HTTP API：它自带模型管理、GPU 加速、
 * 并且 /api/chat 支持 format:"json"，能大幅降低"模型输出半截 JSON"的概率。
 */
export class OllamaAdapter implements LlmAdapter {
  name: string;
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;

  constructor(baseUrl: string, model: string, timeoutMs = 120_000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.name = `ollama:${model}`;
  }

  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          ...(opts.json ? { format: "json" } : {}),
          // Qwen3 是混合思考模型，抽取这种任务不需要思考链，关掉省时间也省 token
          ...(this.model.startsWith("qwen3") ? { think: false } : {}),
          options: { temperature: 0 },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { message?: { content?: string } };
      return data.message?.content ?? "";
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 回放适配器：从固定文件里取答案。
 *
 * 用途是不依赖模型也能把整条管道跑通：校验、兜底、冻结、落库。
 * 等模型装好之后，只换一个配置项。
 */
export class ReplayAdapter implements LlmAdapter {
  name = "replay";
  /** 被真正调用了几次，用来验证「冻结之后不再调模型」 */
  calls = 0;
  private fixtures: Record<string, unknown>;

  constructor(path: string) {
    this.fixtures = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    this.calls += 1;
    const joined = messages.map((m) => m.content).join("\n");
    const day = /【日期】\s*(\d{4}-\d{2}-\d{2})/.exec(joined)?.[1];
    const payload = (day && this.fixtures[day]) ?? this.fixtures["*"] ?? { events: [] };
    return JSON.stringify(payload);
  }
}

/**
 * OpenAI 兼容接口（DeepSeek 官方 API 就是这套）。
 *
 * 为什么留这条路：真正的 DeepSeek-V3 本地跑不动（671B MoE），
 * 想在本地跑只能跑蒸馏版，那本质已经是千问/羊驼了。
 */
export class OpenAiCompatibleAdapter implements LlmAdapter {
  name: string;
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private timeoutMs: number;

  constructor(baseUrl: string, apiKey: string, model: string, timeoutMs = 60_000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.name = `api:${model}`;
  }

  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    if (this.apiKey.length === 0) throw new Error("没有配置 API key");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0,
          stream: false,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createAdapter(cfg: MemoryConfig): LlmAdapter {
  if (cfg.llmBaseUrl.startsWith("replay:")) {
    return new ReplayAdapter(cfg.llmBaseUrl.slice("replay:".length));
  }
  return new OllamaAdapter(cfg.llmBaseUrl, cfg.llmModel, cfg.llmTimeoutMs);
}

/** 探活：装完模型用它确认真的通了 */
export async function pingOllama(cfg: MemoryConfig): Promise<string> {
  const res = await fetch(`${cfg.llmBaseUrl.replace(/\/$/, "")}/api/tags`);
  if (!res.ok) throw new Error(`Ollama 返回 ${res.status}`);
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  const names = (data.models ?? []).map((m) => m.name);
  if (names.length === 0) return "Ollama 在跑，但一个模型都没有。先 `ollama pull qwen3:8b`";
  const has = names.some((n) => n.startsWith(cfg.llmModel.split(":")[0]));
  return `Ollama 在跑，已装模型：${names.join("、")}${has ? "" : `　⚠ 没有 ${cfg.llmModel}`}`;
}
