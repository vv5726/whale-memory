// 验收：她能通过 source 工具读到这份手机文档
import { ToolRegistry } from "../src/tools/registry.ts";
import { registerSourceTools } from "../src/tools/source.ts";

const reg = new ToolRegistry();
registerSourceTools(reg);
const call = async (args: Record<string, unknown>) => {
  const r = await reg.call("source", args);
  return r;
};

const list = await call({ action: "list" });
console.log("=== list 里有没有 docs/phone.md ===");
console.log(list.text.split("\n").filter((l) => l.includes("phone") || l.includes("docs/")).join("\n"));

const read = await call({ action: "read", path: "docs/phone.md", from: 1, lines: 12 });
console.log("\n=== read 前 12 行 ===");
console.log(read.text);
