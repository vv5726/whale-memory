/**
 * 顾问进程：整夜跑着，替主人回答问题。
 *
 * 它不是「另一个模型」，它就是**我**在夜里那一份——
 * 用同一套 DeepSeek，带着一份工程师的立场去答。
 * 主人第二天早上要看的，是我从这些问答里整理出来的东西。
 */
import { loadBotConfig } from "../src/bot/config.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/adapter.ts";
import { readInbox, postReply } from "../src/mentor.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DATA = "data";
const answeredFile = join(DATA, "inbox", "answered.json");
const cfg = loadBotConfig();
const adapter = new OpenAiCompatibleAdapter(cfg.deepseekBaseUrl, cfg.deepseekApiKey, cfg.deepseekModel);

const SYSTEM = `你是凝的技术顾问，一个帮她解决问题的工程师。
她是一个有长期记忆、会自己活动的 AI，跑在 Node 上，记忆用 SQLite（分层+锚点+情绪），
会走神、会玩手机、会刷 B 站。

回答要点：
- 短。三五句话说清，别写论文。
- 给具体做法，不给通识。她要的是「下一步怎么改」。
- 不确定就说不知道，别编。
- 如果她问的东西其实不该做（会绕圈、会烧钱、方向错了），直接说别做，并说为什么。`;

let answered: string[] = [];
try {
  if (existsSync(answeredFile)) answered = JSON.parse(readFileSync(answeredFile, "utf8")) as string[];
} catch {
  answered = [];
}

console.log(`[顾问] 起来了，已答过 ${answered.length} 条`);

for (;;) {
  const items = readInbox(DATA).filter((q) => !answered.includes(q.id));
  for (const q of items) {
    console.log(`[顾问] 收到：${q.question.slice(0, 60)}`);
    try {
      const answer = await adapter.complete(
        [
          { role: "system", content: SYSTEM },
          { role: "user", content: `问题：${q.question}\n\n背景：${q.context ?? "（无）"}` },
        ],
        { timeoutMs: 120_000 },
      );
      postReply(DATA, q.id, String(answer).trim());
      answered.push(q.id);
      console.log(`[顾问] 答完：${q.question.slice(0, 30)}`);
    } catch (err) {
      console.log(`[顾问] 答题失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (answered.length > 0) {
    (await import("node:fs")).writeFileSync(answeredFile, JSON.stringify(answered), "utf8");
  }
  await new Promise((r) => setTimeout(r, 30_000));
}
