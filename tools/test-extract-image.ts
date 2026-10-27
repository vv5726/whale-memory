import { extractText } from "../src/bot/onebot.ts";

// 模拟 NapCat 的 array 格式：文字 + 图片
const payload = {
  message: [
    { type: "text", data: { text: "你看这个" } },
    { type: "image", data: { file: "abc.jpg", url: "http://example.com/a.jpg", summary: "一张图" } },
    { type: "face", data: { id: "467" } },
  ],
  raw_message: "你看这个[CQ:image,file=abc.jpg]",
};

const text = extractText(payload);
console.log("提取结果：" + text);
console.log("含图片 CQ 码：" + text.includes("[CQ:image"));
console.log("含 url：" + text.includes("url="));
console.log("含文字：" + text.includes("你看这个"));
