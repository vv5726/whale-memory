import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dir = join("data", `backup-thinkhook-${ts}`);
mkdirSync(dir, { recursive: true });
copyFileSync("src/bot/service.ts", join(dir, "src_bot_service.ts"));
copyFileSync("data/memory.db", join(dir, "memory.db"));
console.log(`① 备份 → ${dir}`);

const p = "src/bot/service.ts";
let s = readFileSync(p, "utf8");

if (s.includes("【你欠着的事】")) {
  console.log("② 已有，跳过");
} else {
  // 在「你自己琢磨」之前插入：把 status='需跟进' 的事摆出来
  const anchor = "    lines.push(\n      \"现在没人跟你说话。你自己琢磨：\",";
  if (!s.includes(anchor)) {
    console.log("✗ 找不到插入点");
    process.exit(1);
  }
  const inject = [
    "    // ★ 钩子：先看有没有挂着的半截事。",
    "    //   之前它翻完记忆/锚点/知识库，发现都是已经结束的事，就默认「没什么想做的」。",
    "    //   而「需跟进」的记忆正是它欠着的活儿。",
    "    try {",
    "      const pendingWork = this.db",
    '        .prepare("SELECT title, status, next_action, responsible FROM events WHERE archived = 0 AND status = ? ORDER BY memory_value DESC LIMIT 5")',
    '        .all("需跟进") as Array<{ title: string; status: string; next_action: string; responsible: string }>;',
    "      if (pendingWork.length > 0) {",
    '        lines.push("【你欠着的事】（status=需跟进）");',
    "        for (const w of pendingWork) {",
    "          const next = String(w.next_action || \"\").trim();",
    '          lines.push(`- ${String(w.title).slice(0, 40)}${next ? `　下一步：${next.slice(0, 30)}` : ""}`);',
    "        }",
    '        lines.push("这些不是过去的事，是还没完的。能推进一步就推，推不动就说为什么。", "");',
    "      }",
    "    } catch {",
    "      // 读不出来不影响走神",
    "    }",
    "",
    anchor,
  ].join("\n");
  s = s.replace(anchor, inject);
  writeFileSync(p, s, "utf8");
  console.log("② 已插入「你欠着的事」钩子");
}
