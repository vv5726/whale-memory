import { readFileSync, writeFileSync } from "node:fs";

// ① 缓存签名加版本号：规则一改，旧缓存全部作废
{
  const p = "src/llm/extract.ts";
  let s = readFileSync(p, "utf8");

  if (!s.includes("EXTRACT_VERSION")) {
    s = s.replace(
      "  const sig = (() => {",
      [
        "  // ⚠️ 改抽取规则（新增字段、改问法）时必须动这个版本号——",
        "  //    否则旧缓存会被直接复用，新规则一次都不跑。",
        "  const EXTRACT_VERSION = \"v3-myview\";",
        "",
        "  const sig = (() => {",
      ].join("\n"),
    );

    // 把版本号拼进签名
    s = s.replace(
      "    const tail = turns.slice(-2).map((t) => t.text.slice(0, 24)).join(\"|\");",
      "    const tail = turns.slice(-2).map((t) => t.text.slice(0, 24)).join(\"|\");\n    const sigBase = `${turns.length}:${total}:${head}:${tail}`;\n    return `${EXTRACT_VERSION}:${sigBase}`;",
    );

    writeFileSync(p, s, "utf8");
    console.log("缓存签名已加版本号");
  }
}

// ② 「主人」在抽取结果里也要替换掉
{
  const p = "src/llm/extract.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("先把「主人」")) {
    s = s.replace(
      "        detail: (() => {",
      [
        "        title: String(str(d.title, 60)).replace(/主人/g, names.user),",
        "        detail: (() => {",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("「主人」替换已加");
  }
}
