import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runChatWithTools } from "../llm/toolchat.ts";
import type { ToolRegistry } from "../tools/registry.ts";
import type { BotConfig } from "./config.ts";
import { dayKey } from "../util.ts";

export interface ReadingReport {
  at: number;
  task: string;
  /** 给主对话看的简报，短到不占上下文 */
  summary: string;
  /** 这一轮实际调了哪些工具（调试用） */
  toolsUsed: string[];
  /** 花了几次视频额度 */
  videosRead: number;
}

/**
 * 阅读员（子代理）。
 *
 * 为什么要把「看」和「说」分开：
 *  B 站一期视频的字幕 4000 字，如果它直接进主对话的上下文，
 *  既贵又稀释——模型会被字幕里的细节带跑，反而说不出自己的判断。
 *  所以让一个**只负责读**的代理去读，读完压成一份几百字的内部简报；
 *  主对话只看到简报，用自己的口吻决定怎么说。
 *
 * 这抄的是 dsh-bili-subagent 的做法（「子代理去看，伙伴回来说」）。
 */
export class ReaderAgent {
  private cfg: BotConfig;
  private tools: ToolRegistry;

  constructor(cfg: BotConfig, allTools: ToolRegistry) {
    this.cfg = cfg;
    // 只给读的工具：阅读员不许点赞、不许评论、不许发动态
    this.tools = allTools.subset(["bili_hot", "bili_rank", "bili_search", "bili_info", "bili_subtitle"]);
  }

  private system(): string {
    return [
      "你是阅读员，不是聊天对象。你的工作是把内容读进来，写一份给「伙伴」看的内部简报。",
      "",
      "规则：",
      "1. 不要寒暄，不要对谁说话，不要写「我觉得你可以看看」。",
      "2. 先翻（bili_hot / bili_search），再挑，最后读（bili_subtitle）。别一上来就读。",
      "3. 读之前先判断值不值得花额度：标题党、纯情绪、切片、预告片，直接跳过。",
      "4. 每读一条，用一两句写清楚它到底讲了什么——**具体的**，不要「讲了财富规划」这种废话。",
      "5. 最后给出：哪一条最值得继续聊，为什么。",
      "6. 读不进去/没字幕/内容空洞，就直说，不要凑字数。",
      "7. 如果内容跟下面「伙伴的处境」有关（他在做的事、卡住的地方），单独标一行",
      "   【跟我们有关】：说清这一条能用在哪儿、能不能马上用。无关就不用写这行。",
      "",
      "输出格式（纯文本，300 字以内）：",
      "【读了】BV号 标题 —— 要点",
      "【跟我们有关】BV号 —— 能用在哪儿",
      "【值得聊】BV号 —— 一句话理由",
      "【跳过】为什么跳",
    ].join("\n");
  }

  async read(task: string): Promise<ReadingReport> {
    const started = Date.now();
    const result = await runChatWithTools(
      {
        baseUrl: this.cfg.deepseekBaseUrl,
        apiKey: this.cfg.deepseekApiKey,
        model: this.cfg.deepseekModel,
        timeoutMs: 120_000,
      },
      [
        { role: "system", content: this.system() },
        { role: "user", content: task },
      ],
      this.tools,
      6,
      undefined,
      "reader",
    );

    const summary = result.text.trim();
    const report: ReadingReport = {
      at: started,
      task,
      summary,
      toolsUsed: result.calls.map((c) => c.name),
      videosRead: result.calls.filter((c) => c.name === "bili_subtitle" && c.ok).length,
    };

    // 简报落盘：主对话下次可以从这儿读，不必重新跑一遍
    const dir = join(this.cfg.dataDir, "reading");
    mkdirSync(dir, { recursive: true });
    const time = new Date(started).toTimeString().slice(0, 5);
    appendFileSync(
      join(dir, `${dayKey(started)}.md`),
      `## ${time}　${task}\n\n${summary}\n\n`,
      "utf8",
    );

    console.log(`[reader] 读了 ${report.videosRead} 个视频，简报 ${summary.length} 字，工具 ${report.toolsUsed.join("→")}`);
    return report;
  }
}
