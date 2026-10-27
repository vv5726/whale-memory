import { readFileSync, writeFileSync } from "node:fs";

const p = "src/bot/service.ts";
let s = readFileSync(p, "utf8");
const NL = "\n";

const marker = "  /** 今天看过什么、记了什么：常驻注入，不依赖检索 */";
if (!s.includes("knownText()")) {
  const block = [
    "  /** 回答里出现数字时，这些文本也算「有依据」的来源 */",
    "  private knownText(): string {",
    "    const t = this.todaySnapshot();",
    '    return [readSelf(this.cfg.dataDir), t.watched.join("\\n"), t.notes.join("\\n")].join("\\n");',
    "  }",
    "",
    marker,
  ].join(NL);
  s = s.replace(marker, block);
}

// 两处守卫的「合法来源」都补上 knownText
s = s.replaceAll("`${memory.contextBlock}\\n${out.toolText}`", "`${memory.contextBlock}\\n${out.toolText}\\n${this.knownText()}`");
s = s.replaceAll("`${memory.contextBlock}\\n${toolText}`", "`${memory.contextBlock}\\n${toolText}\\n${this.knownText()}`");

writeFileSync(p, s, "utf8");
console.log(s.includes("knownText()") ? "knownText 已加" : "失败");
console.log(`引用次数：${(s.match(/this\.knownText\(\)/g) ?? []).length}`);
