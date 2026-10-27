import { addKnowledge } from "../src/knowledge.ts";

const cards = [
  {
    title: "plan_add：给自己定一条计划",
    content:
      "什么时候用：想清楚「有件事我要去做，但怕忘」的时候。\n四样必须全给：what 要干什么、why 为什么要干（写真动机，不写套话）、intervalMinutes 每多少分钟提醒一次、anchor 关联锚点（人事/主题名，没有就新建一个）。定计划的时间自动记。\n注意：四项缺一样就会被拒；想立刻到点可以传过去的 remindAt。",
  },
  {
    title: "plan_list：看计划表",
    content:
      "什么时候用：想知道自己现在有几件事压着、都为什么做、下次什么时候提醒。\n参数：status=active（默认）/ done / all；anchor 只看某个锚点下的。\n注意：每条带 id，改/删/完成都要用它。",
  },
  {
    title: "plan_due：看有没有到点的",
    content:
      "什么时候用：想主动查一下现在有没有该做的事。\n注意：它会把到点的计划记一次提醒、把下次往后推一个间隔——所以别反复调它玩。平时到点提醒会自动出现在提示词里，不用手动查。",
  },
  {
    title: "plan_update：改计划（含改时间）",
    content:
      "什么时候用：计划要调整——干什么变了、原因变了、想换提醒频率、想推迟/提前，都改这条。\n参数：id 必填，其余只传要改的（what/why/intervalMinutes/remindAt/anchor/status）。\n注意：改 remindAt 就等于「再定一次时间」，原来那次提醒作废。",
  },
  {
    title: "plan_done：标成做完了",
    content: "什么时候用：事情真做完了。不删除，plan_list status=done 还能看到干过什么。\n参数：id。",
  },
  {
    title: "plan_delete：删掉一条计划",
    content: "什么时候用：确定这件事不再需要了。想留记录就 plan_done，别删。\n参数：id。",
  },
  {
    title: "plan_soon：看接下来几条",
    content: "什么时候用：只想扫一眼最近要做什么，不记提醒。\n参数：limit（默认 5）。",
  },
];

for (const c of cards) addKnowledge("data", { category: "工具", title: c.title, content: c.content, source: "工具说明书" });
console.log(`写了 ${cards.length} 张计划工具卡`);
