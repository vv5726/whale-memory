import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 顾问通道。
 *
 * 她遇到搞不定的问题会去找主人。但人晚上要睡觉——
 * 所以有些问题该问「技术顾问」（另一个跑在后台的我），而不是把主人吵醒。
 *
 * 实现很土但可靠：一个文件当信箱。
 *   她写 → inbox.jsonl
 *   顾问读、回 → outbox.jsonl
 *   她下次开口前读一眼该收到的回复
 */
export interface InboxItem {
  id: string;
  at: number;
  from: "her";
  question: string;
  context?: string;
}

export interface OutboxItem {
  id: string;
  at: number;
  answer: string;
}

function dirOf(dataDir: string): string {
  return join(dataDir, "inbox");
}

const inboxFile = (d: string) => join(dirOf(d), "inbox.jsonl");
const outboxFile = (d: string) => join(dirOf(d), "outbox.jsonl");
const seenFile = (d: string) => join(dirOf(d), "seen.json");

/** 她问一个问题 */
export function askMentor(dataDir: string, question: string, context = ""): InboxItem {
  const dir = dirOf(dataDir);
  mkdirSync(dir, { recursive: true });
  const item: InboxItem = {
    id: `q_${Date.now().toString(36)}`,
    at: Date.now(),
    from: "her",
    question: String(question).slice(0, 1500),
    context: String(context).slice(0, 800),
  };
  appendFileSync(inboxFile(dataDir), `${JSON.stringify(item)}\n`, "utf8");
  return item;
}

/** 读所有问题（顾问用） */
export function readInbox(dataDir: string): InboxItem[] {
  const f = inboxFile(dataDir);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as InboxItem;
      } catch {
        return null;
      }
    })
    .filter((x): x is InboxItem => x !== null);
}

/** 顾问写回一条 */
export function postReply(dataDir: string, questionId: string, answer: string): void {
  const dir = dirOf(dataDir);
  mkdirSync(dir, { recursive: true });
  const item: OutboxItem = { id: questionId, at: Date.now(), answer: `【顾问·夜间代答】${String(answer).slice(0, 2000)}` };
  appendFileSync(outboxFile(dataDir), `${JSON.stringify(item)}\n`, "utf8");
}

/** 她取「还没看过」的回复 */
export function takeReplies(dataDir: string): OutboxItem[] {
  const f = outboxFile(dataDir);
  if (!existsSync(f)) return [];
  const all = readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as OutboxItem;
      } catch {
        return null;
      }
    })
    .filter((x): x is OutboxItem => x !== null);

  let seen: string[] = [];
  try {
    if (existsSync(seenFile(dataDir))) seen = JSON.parse(readFileSync(seenFile(dataDir), "utf8")) as string[];
  } catch {
    seen = [];
  }

  const fresh = all.filter((r) => !seen.includes(r.id));
  if (fresh.length > 0) {
    writeFileSync(seenFile(dataDir), JSON.stringify([...seen, ...fresh.map((f2) => f2.id)]), "utf8");
  }
  return fresh;
}
