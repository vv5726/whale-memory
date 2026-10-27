/**
 * 把「10003 = 他 的女朋友」写进库，并把她加进私聊白名单。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { openDb } from "../src/db.ts";
import { aboutPerson } from "../src/about-person.ts";

const QQ = "10003";
const OWNER = "10001";

// ① 私聊白名单：她发消息凝才会回
const botPath = "data/bot.json";
const bot = JSON.parse(readFileSync(botPath, "utf8"));
const allow: number[] = Array.isArray(bot.allowPrivate) ? bot.allowPrivate : [];
if (!allow.includes(Number(QQ))) allow.push(Number(QQ));
bot.allowPrivate = allow;
writeFileSync(botPath, JSON.stringify(bot, null, 2), "utf8");
console.log("  allowPrivate:", JSON.stringify(bot.allowPrivate));

// ② 关系写进记忆（人物卡会带出来）
const db = openDb(bot.memoryDb ?? "data/memory.db");
const r1 = aboutPerson(db, {
  person: QQ,
  speakerId: QQ,
  content:
    "4 是谁：他 的女朋友。他 在 2026-10-26 明确说过「10003 是 他 的女朋友」。她昵称「虔诚」，在群里跟凝聊过（想减肥又想吃、说凝说话像她男朋友）。对她就当 他 身边的人对待，别装不熟，也别乱开玩笑。",
});
console.log("  关系写入:", r1.ok, r1.text.slice(0, 60));

const r2 = aboutPerson(db, {
  person: OWNER,
  speakerId: OWNER,
  content: "2026-10-26 加了女朋友（QQ 10003 / 昵称「虔诚」）为好友，并且把她拉进了跟凝的私聊白名单。",
});
console.log("  主人侧写入:", r2.ok, r2.text.slice(0, 60));
db.close();
