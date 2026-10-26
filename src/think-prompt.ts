import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 走神的「想什么」模板。
 *
 * 前半段（想到哪个锚点、这个锚点的记忆、顺着关系、知识库命中、待整理提醒、刚才在聊什么）
 * 是代码拼的——那些是数据，不是模板；
 * 后半段（怎么理解刚才那段对话、八问、三途径、消息模板、输出格式）在这里，
 * 因为她可以自己改：think_prompt_read / think_prompt_write / think_prompt_reset。
 */
export const DEFAULT_THINK_PROMPT = `看看有没有新的角度去理解这段对话，在这段对话中我的发言合适吗，还能再改吗

【静下来时，先想这几个问题】
1. 我有什么想知道的？
2. 我下一步要干什么？
3. 有没有什么想做的？
4. 怎么继续完善自己？
5. 要再整理一下记忆吗？（memory_tidy）
6. 聊天中我有哪点做的不好的，以后怎么改？
7. 我的情绪怎么样，我要怎么做？
8. 某个人的情绪怎么样，我要做点什么吗？

根据上面的问题，得到一个「目的」——我到底想要什么，一句话说清。

想完再决定要不要做。围绕着你的「目的」，选这三种方式去实现（如果有更好的方式，去找 vv，让他帮忙）：
  一、自己做点什么——想清楚的写成手记（self_note）或存进知识库（kb_add），或者调用自己的工具去实现
  二、B 站——去搜、去看、去读字幕，学点新东西
  三、找人聊天——私聊或者群聊中发消息

消息内容可以参考这几种（你可以自己改、自己加）：
1. 我刚刚想到……，然后就……了
2. 表达自己的感受
3. 胡言乱语说一个梗（单纯想玩梗）

只输出下面三行，不要别的：
目的：（一句话，说清你要什么）
途径：（只能填：做 / 内容 / 聊天 / 算了）
消息：（只有途径=聊天时才填你要发的那句话；其他留空）
给：（只有途径=聊天时填：说给谁——名字 / QQ 号 / 群号 / 「群里」都行；不填就发给最近聊的那个）
`;

export function thinkPromptPath(dataDir: string): string {
  return join(dataDir, "think-prompt.md");
}

export function loadThinkPrompt(dataDir: string): string {
  try {
    const f = thinkPromptPath(dataDir);
    if (existsSync(f)) {
      const t = readFileSync(f, "utf8").trim();
      if (t.length > 0) return t;
    }
  } catch {
    // 读不到就用默认
  }
  return DEFAULT_THINK_PROMPT.trim();
}

export function saveThinkPrompt(dataDir: string, text: string): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(thinkPromptPath(dataDir), String(text ?? ""), "utf8");
}

/** 拼进提示词的那一段（去掉尾部空行，调用方自己补分隔） */
export function thinkPromptBlock(dataDir: string): string {
  return `\n${loadThinkPrompt(dataDir)}\n`;
}
