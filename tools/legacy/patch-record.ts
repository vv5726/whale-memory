import { readFileSync, writeFileSync } from "node:fs";

// 1) service 加 recordNote
const sp = "src/bot/service.ts";
let s = readFileSync(sp, "utf8");
if (!s.includes("recordNote(")) {
  const marker = "  /** 把工具表交出去（阅读员要用同一个表，但只取读的那一部分） */";
  const block = [
    "  /** 把一条笔记直接写进记忆（阅读员读到的内容走这条路，保证读过就记得） */",
    "  recordNote(text: string): void {",
    "    try {",
    "      recordOwnNote(this.db, text, Date.now());",
    "    } catch (err) {",
    '      console.warn("[bot] 记笔记失败:", err instanceof Error ? err.message : String(err));',
    "    }",
    "  }",
    "",
    marker,
  ].join("\n");
  s = s.replace(marker, block);
  if (!s.includes('from "../notes.ts"')) {
    s = s.replace('import { readSelf, ensureSelfSeed } from "../self.ts";', 'import { readSelf, ensureSelfSeed } from "../self.ts";\nimport { recordOwnNote } from "../notes.ts";');
  }
  writeFileSync(sp, s, "utf8");
  console.log("service.recordNote 已加");
}

// 2) autonomy：简报里每条【读了】都落一条记忆
const ap = "src/bot/autonomy.ts";
let a = readFileSync(ap, "utf8");
if (!a.includes("recordNote(")) {
  const anchor = "        // 主对话只拿到简报，看不见字幕原文";
  const block = [
    "        // 简报里每一条「读过的」，都单独落一条记忆——读过的必须记得住",
    "        for (const line of report.summary.split(\"\\n\")) {",
    "          const m = /^【读了】\\s*(.+)$/.exec(line.trim());",
    "          if (m) this.service.recordNote(`读到的：${m[1]!.trim()}`);",
    "        }",
    "",
    anchor,
  ].join("\n");
  a = a.replace(anchor, block);
  writeFileSync(ap, a, "utf8");
  console.log("autonomy 已接入逐条落库");
}
