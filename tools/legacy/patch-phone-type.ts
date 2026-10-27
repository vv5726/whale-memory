import { readFileSync, writeFileSync } from "node:fs";

const p = "src/tools/phone.ts";
let s = readFileSync(p, "utf8");

const old = `      // adb input text 不认空格和中文，空格用 %s 代替
      await adb(opts, ["-s", device, "shell", "input", "text", text.replace(/ /g, "%s")]);
      return { ok: true, text: \`输入了 \${text.length} 个字符\` };`;

const neu = `      // adb input text 不认空格和中文，空格用 %s 代替
      await adb(opts, ["-s", device, "shell", "input", "text", text.replace(/ /g, "%s")]);

      // 打完自己看一眼：字还在屏幕上吗？
      // 不在输入框里 = 很可能已经被发出去了。它以前不知道自己发出去了，就是因为没这一步。
      await sleep(600);
      let verdict = "";
      try {
        const screen = await dumpUi(opts, device);
        const texts = screen.texts.join(" ");
        const stillThere = texts.includes(text) || texts.includes(text.replace(/\\s+/g, ""));
        const hasSend = /发送|send/i.test(texts);
        if (stillThere) {
          verdict = hasSend
            ? "字还在输入框里，旁边有「发送」，还没发出去——要发就点发送。"
            : "字已经打进去了（没看到发送按钮）。";
        } else {
          verdict = "字不在屏幕上了——很可能已经发出去了。如果是聊天界面，对方已经看到了。";
        }
      } catch {
        verdict = "打进去了，但没能确认有没有发出去。";
      }

      return { ok: true, text: \`输入了 \${text.length} 个字符。\${verdict}\` };`;

if (s.includes(old)) {
  s = s.replace(old, neu);
  writeFileSync(p, s, "utf8");
  console.log("phone_type：打完会回看一眼");
} else {
  console.log("锚点没匹配");
}
