/**
 * 验证「工具体检」：能对出哪些工具没写卡、哪些卡里的工具名已经不存在。
 * 用假的工具清单 + 假知识库，不碰线上数据。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ToolRegistry } from "../src/tools/registry.ts";
import { registerToolAuditTools } from "../src/tools/tool-audit.ts";

const tmpDir = "data/tmp-tool-audit";
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  // 三个真工具
  const reg = new ToolRegistry();
  for (const name of ["alpha_tool", "beta_tool", "gamma_tool"]) {
    reg.register({ name, description: "测试用", parameters: { type: "object", properties: {} }, handler: async () => ({ ok: true, text: "ok" }) });
  }

  // 知识库：只写了 alpha_tool 的卡，还提到一个不存在的 old_tool
  writeFileSync(
    join(tmpDir, "knowledge.json"),
    JSON.stringify({
      entries: [
        { category: "工具", title: "alpha_tool：怎么用", content: "什么时候用：测试。写什么：随便。", anchors: [] },
        { category: "工具", title: "beta_tool 和 old_tool 的关系", content: "old_tool 已经改名了。", anchors: [] },
        { category: "B站", title: "无关条目", content: "gamma_tool 不在工具分类里，不算卡。", anchors: [] },
      ],
    }),
    "utf8",
  );

  registerToolAuditTools(reg, { dataDir: tmpDir });
  check("工具注册成功", reg.names().includes("tool_audit"));

  const r = await reg.call("tool_audit", {});
  console.log(r.text.split("\n").map((l) => `  ${l}`).join("\n"));

  check("说了总数与覆盖情况", /工具清单：\d+ 个/.test(r.text));
  check("抓到没写卡的 gamma_tool", r.text.includes("gamma_tool"));
  check("已经写过卡的 alpha_tool 不在缺失里", !/【没写卡的[\s\S]*?\balpha_tool\b/.test(r.text));
  check("抓到卡里不存在的 old_tool", r.text.includes("old_tool"));
  check("别的分类不算卡（gamma_tool 仍算缺失）", r.text.includes("gamma_tool"));

  const v = await reg.call("tool_audit", { showCovered: true });
  check("showCovered=true 时列出已覆盖的", v.text.includes("【已经有卡的") && v.text.includes("alpha_tool"));
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
