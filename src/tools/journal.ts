import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { recordOwnNote } from "../notes.ts";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 它自己的手记。
 *
 * 自主活动时看过的、想过的、决定不看的，都往这儿记一笔。
 * 跟记忆库不同：记忆是「发生过的事」，手记是「它自己怎么想的」。
 */
export function journalPath(dataDir: string, day: string): string {
  return join(dataDir, "journal", `${day}.md`);
}

export function appendJournal(dataDir: string, day: string, text: string): void {
  const dir = join(dataDir, "journal");
  mkdirSync(dir, { recursive: true });
  const path = journalPath(dataDir, day);
  if (!existsSync(path)) appendFileSync(path, `# ${day}\n\n`, "utf8");
  appendFileSync(path, `${text.trim()}\n\n`, "utf8");
}

export function readJournal(dataDir: string, day: string): string {
  const path = journalPath(dataDir, day);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function registerJournalTools(
  registry: ToolRegistry,
  dataDir: string,
  today: () => string,
  /** 有库就往库里也投一份：手记是记忆的原料，不能只躺在文件里 */
  db?: DatabaseSync,
): void {
  const note: ToolDefinition = {
    name: "self_note",
    description:
      "往今天的手记里写一笔：看到了什么、怎么想的、为什么决定不看某个东西。没人跟你说话的时候用这个记录你自己。",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "一两句话，写真的" } },
      required: ["text"],
    },
    handler: async (args) => {
      const text = String(args.text ?? "").trim();
      if (text.length === 0) return { ok: false, text: "没写东西" };
      if (text.length > 600) return { ok: false, text: "太长了，600 字以内" };
      appendJournal(dataDir, today(), text);
      // 关键：手记同时进记忆管道，睡觉时会被抽取成正式记忆。
      // 以前只写文件，所以「读过的东西」永远不会被想起来。
      if (db) {
        try {
          recordOwnNote(db, text, Date.now());
        } catch {
          // 落库失败也不能让手记失败
        }
      }
      return { ok: true, text: `记下了：${text.slice(0, 30)}` };
    },
  };
  registry.register(note);

  const read: ToolDefinition = {
    name: "self_journal",
    description: "读今天（或指定日期）的手记，看看自己之前写了什么。",
    parameters: {
      type: "object",
      properties: { day: { type: "string", description: "YYYY-MM-DD，默认今天" } },
    },
    handler: async (args) => {
      const day = String(args.day ?? "").trim() || today();
      const text = readJournal(dataDir, day);
      return { ok: true, text: text.length > 0 ? text.slice(0, 3000) : `${day} 还没写什么` };
    },
  };
  registry.register(read);
}
