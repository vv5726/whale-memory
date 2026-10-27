import { readFileSync, writeFileSync } from "node:fs";

// ── 修额度显示：0 表示不限，不能说成「还剩 0 个」──
{
  const p = "src/bot/persona.ts";
  let s = readFileSync(p, "utf8");
  const old = [
    "  if (input.quota) {",
    "    const q = input.quota;",
    "    const videoLeft = Math.max(0, q.videoLimit - q.videoUsed);",
  ].join("\n");
  const neu = [
    "  if (input.quota) {",
    "    const q = input.quota;",
    "    const videoLeft = Math.max(0, q.videoLimit - q.videoUsed);",
    "    const videoLine =",
    "      q.videoLimit > 0",
    "        ? `看视频：今天 ${q.videoLimit} 个，已经看了 ${q.videoUsed} 个，还剩 ${videoLeft} 个。`",
    "        : `看视频：不限次数（今天已经看了 ${q.videoUsed} 个）。`;",
  ].join("\n");
  if (s.includes(old)) {
    s = s.replace(old, neu);
    s = s.replace(
      '      `看视频：今天 ${q.videoLimit} 个，已经看了 ${q.videoUsed} 个，还剩 ${videoLeft} 个。`,',
      "      videoLine,",
    );
    s = s.replace(
      '      `点赞/评论/弹幕/动态：今天 ${q.writeLimit} 次，已用 ${q.writeUsed} 次。这类动作发出去所有人都看得见，`,',
      "      q.writeLimit > 0\n        ? `点赞/评论/弹幕/动态：今天 ${q.writeLimit} 次，已用 ${q.writeUsed} 次。这类动作发出去所有人都看得见，`\n        : `点赞/评论/弹幕/动态：不限次数（今天已用 ${q.writeUsed} 次）。这类动作发出去所有人都看得见，`,",
    );
    writeFileSync(p, s, "utf8");
    console.log("额度显示已修：0 = 不限");
  } else {
    console.log("额度块锚点没匹配");
  }
}
