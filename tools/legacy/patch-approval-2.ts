import { readFileSync, writeFileSync } from "node:fs";

const p = "src/tools/bili.ts";
let s = readFileSync(p, "utf8");

// 插入一个「要不要先问」的小工具
if (!s.includes("const askFirst")) {
  const anchor = "  const comment: ToolDefinition = {";
  const helper = [
    "  /**",
    "   * 对外可见的动作，先问他一句。",
    "   * 返回 null 表示不用问（已经批准过，或者关掉了请示）。",
    "   */",
    "  const askFirst = (",
    "    kind: \"comment\" | \"danmaku\" | \"dynamic\",",
    "    bvid: string,",
    "    payload: string,",
    "    what: string,",
    "    args: Record<string, unknown>,",
    "  ): { ok: boolean; text: string } | null => {",
    "    if (args._approved === true) return null;",
    "    if (opts.approvalRequired === false) return null;",
    "    if (!opts.db) return null;",
    "    const ap = createApproval(opts.db, { kind, bvid, payload, what });",
    "    opts.notify?.(ap.message);",
    "    return {",
    "      ok: true,",
    "      text: `这个要先问过他（编号 ${ap.shortId}），已经发过去了。他没回之前别再问一遍。`,",
    "    };",
    "  };",
    "",
    anchor,
  ].join("\n");
  s = s.replace(anchor, helper);
  console.log("askFirst 已插入");
}

// 评论：校验通过后先问
s = s.replace(
  '      if (text.length > 500) return { ok: false, text: "评论太长了（B站限制 500 字以内）" };',
  [
    '      if (text.length > 500) return { ok: false, text: "评论太长了（B站限制 500 字以内）" };',
    '      const askComment = askFirst("comment", bvid, JSON.stringify({ bvid, text }), `在 ${bvid} 下评论「${text.slice(0, 40)}」`, args);',
    "      if (askComment) return askComment;",
  ].join("\n"),
);

// 弹幕：校验通过后先问
s = s.replace(
  '      if (text.length > 100) return { ok: false, text: "弹幕太长了（100 字以内）" };',
  [
    '      if (text.length > 100) return { ok: false, text: "弹幕太长了（100 字以内）" };',
    '      const askDm = askFirst("danmaku", bvid, JSON.stringify({ bvid, text, atSec: Number(args.atSec) || 5 }), `在 ${bvid} 第 ${Number(args.atSec) || 5} 秒发弹幕「${text.slice(0, 40)}」`, args);',
    "      if (askDm) return askDm;",
  ].join("\n"),
);

// 动态：校验通过后先问
s = s.replace(
  '      if (text.length > 2000) return { ok: false, text: "动态太长了" };',
  [
    '      if (text.length > 2000) return { ok: false, text: "动态太长了" };',
    '      const askDyn = askFirst("dynamic", "", JSON.stringify({ text }), `发一条动态「${text.slice(0, 40)}」`, args);',
    "      if (askDyn) return askDyn;",
  ].join("\n"),
);

writeFileSync(p, s, "utf8");
console.log(`askFirst 复用 ${(s.match(/askFirst\(/g) ?? []).length} 处`);
