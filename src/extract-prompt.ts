import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 记忆抽取的提示词：她也能看、能改。
 *
 * 以前这段是写死在 src/llm/extract.ts 里的字符串，她自己碰不到，
 * 结果就是她会说「我把抽取提示词改了」——其实改的是另一个东西。
 *
 * 现在分三层：
 *   1. 这里 DEFAULT_PROMPT_TEMPLATE —— 兜底模板，代码里的「原版」。文件不存在就走它。
 *   2. data/extract-prompt.md     —— 她改过的整套模板。有就用它，覆盖原版。
 *   3. data/extract-rules.md      —— 她加的零散规矩，前缀到模板末尾（优先级同正文）。
 *
 * 模板里只认这几个占位符，改坏了会被工具拦下来：
 *   {{turns}} {{chars}} {{low}} {{high}} {{user}} {{assistant}} {{anchors}}
 *
 * 模板一变，抽取缓存自动作废（见 promptVersion，sig 里带了它的哈希）。
 */
export function promptPath(dataDir: string): string {
  return join(dataDir, "extract-prompt.md");
}

export function loadPromptTemplate(dataDir: string): string {
  try {
    const f = promptPath(dataDir);
    if (!existsSync(f)) return "";
    return readFileSync(f, "utf8").trim();
  } catch {
    return "";
  }
}

/** text 传 null = 删掉自定义模板，回到代码里的原版 */
export function savePromptTemplate(dataDir: string, text: string | null): void {
  const f = promptPath(dataDir);
  if (text === null) {
    if (existsSync(f)) rmSync(f);
    return;
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(f, `${String(text).trim()}\n`, "utf8");
}

export const PLACEHOLDERS = ["{{turns}}", "{{chars}}", "{{low}}", "{{high}}", "{{user}}", "{{assistant}}", "{{anchors}}"];

export interface PromptVars {
  turns: number;
  chars: number;
  low: number;
  high: number;
  user: string;
  assistant: string;
  anchors: string;
}

export function renderPrompt(template: string, v: PromptVars): string {
  return template
    .replaceAll("{{turns}}", String(v.turns))
    .replaceAll("{{chars}}", String(v.chars))
    .replaceAll("{{low}}", String(v.low))
    .replaceAll("{{high}}", String(v.high))
    .replaceAll("{{user}}", v.user)
    .replaceAll("{{assistant}}", v.assistant)
    .replaceAll("{{anchors}}", v.anchors);
}

/** 用模板内容的短哈希做版本号：改了模板，缓存自然作废 */
export function promptVersion(template: string): string {
  const src = template.length > 0 ? template : "default";
  let h = 0;
  for (let i = 0; i < src.length; i += 1) {
    h = (h * 31 + src.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

/** 写之前先查：JSON 结构那几个键必须还在，占位符不能拼错 */
export function checkPromptTemplate(text: string): string[] {
  const problems: string[] = [];
  const t = String(text ?? "");
  if (t.trim().length < 80) problems.push("太短了（少于 80 字），不像一份完整的抽取提示词");
  for (const key of ["events", "title", "detail", "my_view"]) {
    if (!t.includes(key)) problems.push(`少了「${key}」——解析层要按这个名字取值`);
  }
  for (const m of t.matchAll(/\{\{([^}]*)\}\}/g)) {
    const name = `{{${m[1]}}}`;
    if (!PLACEHOLDERS.includes(name)) problems.push(`不认识的占位符 ${name}`);
  }
  return problems;
}

export const DEFAULT_PROMPT_TEMPLATE = `你是记忆抽取器。把一段聊天整理成结构化记忆。
只输出 JSON，不要解释、不要 markdown 代码块。格式：
{"events":[{"title":"不超过24字，带能检索到的关键词","detail":"这件事的正文","cause":"前因，没有就 null","effect":"后果，没有就 null","core":"最能唤起画面的细节","affect":{"valence":0,"arousal":0,"tags":["情绪词"],"summary":"一句话感受"},"key_facts":["多年后还要准确复述的词"],"anchors":[{"name":"实体名","kind":"person|place|thing|event|theme","confidence":0.8}],"my_view":"我当时怎么想的，没有就 null","turns":[起轮,止轮],"promise":{"isPromised":false,"what":null}}]}

规则：
1. 这批对话 {{turns}} 轮、约 {{chars}} 字，挑 {{low}}~{{high}} 件最值得记的事。宁少勿滥：一件真事胜过十句寒暄。
2. 一条记忆 = 一件事，不是一句话。同一件事说了几轮就合成一条，不同的事分开记。
   title 写「发生了什么」，带关键词，方便以后检索；不要写「聊天记录」「日常对话」这种空标题。
   detail 写清谁做了什么、为什么、结果怎样。不要复述套话，不要写旁白。
   turns 填这件事的起止轮次，例如 [12,19]。
3. 人称一律写 QQ 号，不写「主人」「对方」「他自己」：他是 {{user}}；我说的话写「{{assistant}}」。
4. affect：valence 负=难受、正=开心；arousal 是强度 0-1；tags 是情绪词；summary 一句话说清感受。
5. 每条都要带 my_view（我当时怎么想的）：我当时觉得重要吗、同意吗、打算怎么办、有没有想说没说的。
   要有具体判断，不要写「我认为这很重要」这种废话。没有真实想法就填 null，别硬编。
6. anchors 只抽人、地点、物品、事件、主题；代词和泛指词（我、你、他、这个、什么）不算锚点。
   已知锚点（能对上就用同一个名字，别造新称呼）：
   {{anchors}}
7. key_facts 放「多年后还要准确复述」的东西：数字、日期、地点、人名、约定，以及原话里的关键词。
8. promise 只有对方明确跟你定下的事才算；没有就 isPromised=false、what=null。
9. 对方的长期要求、偏好、定下的规矩，要单独成一条记下来——这类最容易漏，漏了补不回来。
10. 没把握的字段一律 null，不要编。宁可少一个字段，不要多一段猜的。
`;
