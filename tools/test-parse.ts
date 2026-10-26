import { parseAndValidate } from "../src/llm/extract.ts";

const cases: Array<[string, string]> = [
  ["代码块包着", '```json\n[{"title":"带代码块","detail":"内容","my_view":"判断","turns":[1,2],"anchors":[],"key_facts":[]}]\n```'],
  ["前后带解释", '结果如下：\n[{"title":"前后带话","detail":"内容","my_view":"判断","turns":[1,2],"anchors":[],"key_facts":[]}]\n希望有用'],
  ["对象包着数组", '{"events":[{"title":"包一层","detail":"内容","my_view":"判断","turns":[1,2],"anchors":[],"key_facts":[]}]}'],
];

for (const [name, raw] of cases) {
  const r = parseAndValidate(raw, "vv");
  console.log(`${r.events.length > 0 ? "✓" : "✗"} ${name}：${r.events.length} 条 ${r.events[0] ? "→ " + String(r.events[0].detail).slice(0, 40) : ""}`);
}
