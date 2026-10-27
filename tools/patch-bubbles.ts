import { readFileSync, writeFileSync } from "node:fs";

const p = "src/bot/onebot.ts";
let s = readFileSync(p, "utf8");

if (!s.includes("sendBubbles")) {
  const marker = "  private send(action: Record<string, unknown>): void {";
  const block = [
    "  /**",
    "   * 一条话分几口气发出去。",
    "   *",
    "   * 一次扔一整段像邮件；拆成两三条、中间停半秒到一秒，才像人在打字。",
    "   */",
    "  async sendBubbles(evt: IncomingMessage, text: string): Promise<void> {",
    "    const bubbles = toBubbles(text);",
    "    for (let i = 0; i < bubbles.length; i += 1) {",
    "      if (i > 0) {",
    "        await new Promise((r) => setTimeout(r, bubbleDelay(bubbles[i - 1]!)));",
    "      }",
    "      this.reply(evt, bubbles[i]!);",
    "    }",
    "  }",
    "",
    marker,
  ].join("\n");
  s = s.replace(marker, block);
}

if (!s.includes('from "../bubbles.ts"')) {
  s = 'import { toBubbles, bubbleDelay } from "../bubbles.ts";\n' + s;
}

writeFileSync(p, s, "utf8");
console.log(s.includes("sendBubbles") ? "sendBubbles 已加" : "失败");
