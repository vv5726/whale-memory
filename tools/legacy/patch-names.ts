import { readFileSync, writeFileSync } from "node:fs";

// 1) extractDayWithLlm 接受 names
{
  const p = "src/llm/extract.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace(
    "  turns: Array<{ id: string; role: string; text: string }>,\n): Promise<ExtractDayResult> {",
    [
      "  turns: Array<{ id: string; role: string; text: string; speakerId?: string }>,",
      "  /** 说话人真名：user = 主人，assistant = 她自己 */",
      '  names: { user: string; assistant: string } = { user: "主人", assistant: "凝" },',
      "): Promise<ExtractDayResult> {",
    ].join("\n"),
  );
  writeFileSync(p, s, "utf8");
  console.log("extractDayWithLlm：已收 names");
}

// 2) sleep 传名字
{
  const p = "src/sleep.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("ownerName")) {
    s = s.replace(
      "        extracted = await extractDayWithLlm(db, cfg, index, adapter, day, dayTurns);",
      [
        "        // 取主人的真名：抽取时要把「你/我/他」换成具体的人",
        '        const ownerRow = db.prepare("SELECT display_name FROM people ORDER BY last_seen DESC LIMIT 1").get() as',
        "          | { display_name: string }",
        "          | undefined;",
        '        const ownerName = ownerRow?.display_name || "主人";',
        "        extracted = await extractDayWithLlm(db, cfg, index, adapter, day, dayTurns, { user: ownerName, assistant: \"凝\" });",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("sleep：已传真名");
  } else {
    console.log("sleep：已有");
  }
}
