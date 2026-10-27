import { loadBotConfig } from "../src/bot/config.ts";
import { buildTools } from "../src/tools/index.ts";
import { estimateTokens } from "../src/util.ts";

const cfg = loadBotConfig();
const tools = buildTools(cfg);

const groups: Record<string, string[]> = {
  "时间": ["get_time"],
  "手机": [],
  "B站 读": [],
  "B站 写": [],
  "自我": [],
  "手记": [],
};

for (const t of tools.schema()) {
  const n = t.function.name;
  const line = `${n}（${estimateTokens(JSON.stringify(t))} token）`;
  if (n.startsWith("phone_")) groups["手机"]!.push(line);
  else if (["bili_like", "bili_comment", "bili_danmaku", "bili_dynamic"].includes(n)) groups["B站 写"]!.push(line);
  else if (n.startsWith("bili_")) groups["B站 读"]!.push(line);
  else if (n.startsWith("self_write") || n.startsWith("self_read")) groups["自我"]!.push(line);
  else if (n.startsWith("self_note") || n.startsWith("self_journal")) groups["手记"]!.push(line);
}

let total = 0;
for (const [name, list] of Object.entries(groups)) {
  if (list.length === 0) continue;
  console.log(`\n【${name}】${list.length} 个`);
  for (const l of list) console.log(`  ${l}`);
  total += list.length;
}
console.log(`\n合计 ${total} 个工具，描述共约 ${estimateTokens(JSON.stringify(tools.schema()))} token`);
