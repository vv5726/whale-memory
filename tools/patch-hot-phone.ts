import { readFileSync, writeFileSync } from "node:fs";

// ── 1) registry：能按前缀摘掉工具 ──
{
  const p = "src/tools/registry.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("removePrefix")) {
    s = s.replace(
      "  has(name: string): boolean {",
      [
        "  /** 按前缀摘掉一批（比如手机拔了，把 phone_* 全摘掉） */",
        "  removePrefix(prefix: string): string[] {",
        "    const removed: string[] = [];",
        "    for (const name of [...this.tools.keys()]) {",
        "      if (name.startsWith(prefix)) {",
        "        this.tools.delete(name);",
        "        removed.push(name);",
        "      }",
        "    }",
        "    return removed;",
        "  }",
        "",
        "  has(name: string): boolean {",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("registry：removePrefix 已加");
  }
}

// ── 2) tools/index：导出「单独挂手机工具」的能力 ──
{
  const p = "src/tools/index.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("export function attachPhoneTools")) {
    s += [
      "",
      "/** 设备回来了就地挂上（不用重建整个工具表） */",
      "export function attachPhoneTools(registry: ToolRegistry, cfg: BotConfig): boolean {",
      "  if (!deviceConnected(cfg)) return false;",
      "  if (registry.names().some((n) => n.startsWith(\"phone_\"))) return true;",
      "  registerPhoneTools(registry, cfg);",
      "  return true;",
      "}",
      "",
      "/** 设备走了就摘掉，别让模型以为自己还能操作手机 */",
      "export function detachPhoneTools(registry: ToolRegistry): string[] {",
      "  return registry.removePrefix(\"phone_\");",
      "}",
      "",
    ].join("\n");
    writeFileSync(p, s, "utf8");
    console.log("tools/index：attach/detach 已加");
  }
}
