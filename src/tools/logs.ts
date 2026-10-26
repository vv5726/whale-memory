import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 看自己的日志。
 *
 * 为什么给这个权限：她回答「你为什么这么答」「刚才那个报错是什么」时，
 * 以前只能凭记忆猜；真正的证据在 data/logs/bot.log 里。
 * 这里只读、只给尾巴，不会把 1.4MB 全塞进上下文。
 *
 * 刻意不做的：
 *  - 不给写：日志是证据，能改就没意义了。
 *  - 不给全量：一次最多 200 行，每行截断，避免把上下文吃光。
 */
const MAX_LINES = 200;
const DEFAULT_LINES = 40;
const MAX_CHARS = 6000;
const LINE_CLIP = 240;

function logPathOf(dataDir: string): string {
  return join(dataDir, "logs", "bot.log");
}

/** 2026-10-26T16:18:52.123Z [INFO] [消息] ... → 16:18:52 [消息] ...（本地时间） */
function prettyLine(line: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?\s*\[(INFO|ERR)\]\s?(.*)$/.exec(line);
  const body = m ? `${m[2]} ${m[4]}` : line;
  return body.length > LINE_CLIP ? `${body.slice(0, LINE_CLIP)}…` : body;
}

const ERROR_HINTS = ["[ERR]", "报错", "失败", "出错", "Error", "error", "超时", "❌"];

export function registerLogTools(registry: ToolRegistry, dataDir: string): void {
  const tool: ToolDefinition = {
    name: "read_log",
    description:
      "读你自己的运行日志（只读、只看最近的部分）。想知道「我刚才为什么那么回」「上一句工具调用报了什么错」「重启前发生了啥」，就用它。要证据的时候用它，别凭印象编。可以按关键词或只看报错过滤。",
    parameters: {
      type: "object",
      properties: {
        lines: { type: "integer", description: "看最近多少行，默认 40，最多 200" },
        filter: { type: "string", description: "只看包含这几个字的行，比如 消息 / 回复 / tool / sleep" },
        onlyErrors: { type: "boolean", description: "只看报错、失败这类行" },
      },
    },
    handler: async (args) => {
      const path = logPathOf(dataDir);
      if (!existsSync(path)) {
        return { ok: false, text: `没找到日志文件：${path}（可能是前台直接跑的，没开文件日志）` };
      }

      const rawLines = readFileSync(path, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.length > 0);
      if (rawLines.length === 0) return { ok: true, text: "日志文件还是空的。" };

      const want = Math.min(MAX_LINES, Math.max(1, Math.round(Number(args.lines ?? DEFAULT_LINES)) || DEFAULT_LINES));
      const filter = String(args.filter ?? "").trim();
      const onlyErrors = args.onlyErrors === true;

      let picked = rawLines;
      if (onlyErrors) picked = picked.filter((l) => ERROR_HINTS.some((h) => l.includes(h)));
      if (filter.length > 0) {
        const needle = filter.toLowerCase();
        picked = picked.filter((l) => l.toLowerCase().includes(needle));
      }
      if (picked.length === 0) {
        return { ok: true, text: `日志里没有符合条件（${onlyErrors ? "只看报错" : ""}${filter ? ` 关键词「${filter}」` : ""}）的行。` };
      }

      const tail = picked.slice(-want);
      const head = rawLines[0]!;
      const headTime = /T(\d{2}:\d{2}:\d{2})/.exec(head)?.[1] ?? "?";
      const lastTime = /T(\d{2}:\d{2}:\d{2})/.exec(rawLines[rawLines.length - 1]!)?.[1] ?? "?";
      const cond = [onlyErrors ? "只看报错" : "", filter ? `关键词「${filter}」` : ""].filter(Boolean).join("，");

      const body: string[] = [
        `日志：${path}（共 ${rawLines.length} 行，${headTime} 起${lastTime !== headTime ? ` 到 ${lastTime}` : ""}）`,
        `下面是你最近 ${tail.length} 行${cond ? `（${cond}）` : ""}：`,
        ...tail.map(prettyLine),
      ];

      let text = body.join("\n");
      if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}\n…（截断了，想看更多就缩小行数或加关键词）`;
      return { ok: true, text };
    },
  };
  registry.register(tool);
}
