/**
 * 同一个问题，问不同的模型，并排看回答。
 *
 * 用的是同一份记忆库，所以差别只来自模型本身。
 *
 * 用法：
 *   node tools/compare-chat.ts                          # 默认对比本地 qwen3:8b 和 DeepSeek
 *   node tools/compare-chat.ts --models qwen3:8b,qwen3:14b
 *   node tools/compare-chat.ts --db data/users/10001.db
 */
import { existsSync } from "node:fs";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";
import { OllamaAdapter, OpenAiCompatibleAdapter, type LlmAdapter } from "../src/llm/adapter.ts";

interface Case {
  tag: string;
  question: string;
}

const CASES: Case[] = [
  { tag: "日常", question: "在吗" },
  { tag: "自我认知", question: "你对自己的认知是什么" },
  { tag: "语义·换说法", question: "我妈那次手术结果还好吗" },
  { tag: "幻觉测试", question: "我妹妹结婚我随了多少礼" },
  { tag: "记忆·具体事实", question: "王建国那两千块钱还了吗" },
  { tag: "情绪·情境", question: "团子那次在宠物医院我什么心情" },
];

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  // 默认用基准库（有丰富记忆），没有就退回你的真实库
  const fallback = existsSync("data/bench.db") ? "data/bench.db" : "data/users/10001.db";
  return {
    models: (get("--models") ?? "qwen3:8b,deepseek-chat").split(",").map((s) => s.trim()).filter(Boolean),
    db: get("--db") ?? fallback,
  };
}

function makeAdapter(cfg: ReturnType<typeof loadBotConfig>, model: string): LlmAdapter {
  if (model.startsWith("deepseek")) {
    return new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, model);
  }
  return new OllamaAdapter(cfg.ollamaBaseUrl, model);
}

async function main(): Promise<void> {
  const cfgAll = loadBotConfig();
  const opts = parseArgs();
  const cfg = opts.db ? { ...cfgAll, memoryDb: opts.db } : cfgAll;

  const services = new Map<string, BotService>();
  for (const model of opts.models) {
    services.set(model, new BotService(cfg, { replyAdapter: makeAdapter(cfgAll, model) }));
  }

  console.log(`记忆库：${cfg.memoryDb}`);
  console.log(`模型：${opts.models.join("　vs　")}\n`);

  for (const c of CASES) {
    console.log("═".repeat(72));
    console.log(`【${c.tag}】${c.question}`);

    for (const model of opts.models) {
      const service = services.get(model)!;
      const started = Date.now();
      try {
        const out = await service.say(c.question, "小林");
        const ms = Date.now() - started;
        console.log(`\n  ── ${model}（${(ms / 1000).toFixed(1)}s）`);
        console.log(
          out.reply
            .split("\n")
            .map((line) => `     ${line}`)
            .join("\n"),
        );
      } catch (err) {
        console.log(`\n  ── ${model}　✗ ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log("\n" + "═".repeat(72));
  for (const service of services.values()) service.close();
}

await main();
