import { readFileSync, writeFileSync } from "node:fs";

// ① 事件层：把 sender 原样带出来
{
  const p = "src/bot/onebot.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("senderFields")) {
    s = s.replace(
      "  const sender = (payload.sender ?? {}) as Record<string, unknown>;",
      `  const sender = (payload.sender ?? {}) as Record<string, unknown>;
  // 名字三级回退：群名片 → QQ昵称 → QQ<号>。三级都要留着，
  // 只留一个字符串的话，下游就没法知道「是没设名片，还是根本没拿到昵称」。
  const senderFields = {
    userId: Number(sender.user_id ?? userId) || userId,
    card: String(sender.card ?? "").trim(),
    nickname: String(sender.nickname ?? "").trim(),
    role: String(sender.role ?? ""),
  };`,
    );
    s = s.replace(
      "    userName,\n    text,",
      "    userName,\n    sender: senderFields,\n    text,",
    );
    writeFileSync(p, s, "utf8");
    console.log("① sender 已带出");
  }
}

// ② 当前这句也带 〔名字〕
{
  const p = "src/bot/persona.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("当前这句也带名字")) {
    s = s.replace(
      '  // 当前这句不加前缀——加了它会学着在回答里也写「凝：」\n  messages.push({ role: "user", content: input.message });',
      `  // 当前这句也带名字（否则群里谁在说话它得猜）。
  // 加「〔名字〕」不会让它学着写「凝：」——那个是「名字：」格式，stripNamePrefix 兜着。
  const me = input.currentSpeaker ? \`〔\${input.currentSpeaker}〕\${input.message}\` : input.message;
  messages.push({ role: "user", content: me });`,
    );
    // 类型
    s = s.replace(
      "    /** 场景：群聊还是私聊 */",
      "    /** 此刻说话的人叫什么（群聊必须给，不然它不知道谁在说） */\n    currentSpeaker?: string;\n    /** 场景：群聊还是私聊 */",
    );
    writeFileSync(p, s, "utf8");
    console.log("② 当前消息带名字");
  }
}
