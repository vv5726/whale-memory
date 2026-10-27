/**
 * 验证「它能看见整个群的人」：
 *   · OneBot 的成员列表能解析（群名片优先、脏行丢掉）
 *   · 名册落库、整群覆盖（退群的人会消失）
 *   · 提示词里有一行群情（人少列全名，人多给几个 + 提示调工具）
 *   · 工具 group_members 能查出全部成员
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BotService } from "../src/bot/service.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { parseMemberList } from "../src/bot/onebot.ts";
import { listGroupMembers, hasRoster, rosterLine, saveGroupMembers } from "../src/group-roster.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { registerRosterTools } from "../src/tools/roster.ts";

const tmpDir = "data/tmp-roster";
const tmpDb = join(tmpDir, "memory.db");
const GROUP = 20003;

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  copyFileSync("data/memory.db", tmpDb);
  for (const f of ["tuning.json", "self.md", "speech-rules.txt"]) {
    if (existsSync(join("data", f))) copyFileSync(join("data", f), join(tmpDir, f));
  }

  console.log("=== ① OneBot 成员列表解析 ===");
  const parsed = parseMemberList([
    { user_id: 30001, card: "", nickname: "凝", role: "member" },
    { user_id: 10001, card: "他", nickname: "小鱼", role: "owner" },
    { user_id: 10002, card: "🌿", nickname: "某人", role: "admin" },
    { user_id: "bad", nickname: "脏行" },
  ]);
  console.log(`  ${JSON.stringify(parsed)}`);
  check("解析出 3 个人（脏行丢掉）", parsed.length === 3);
  check("群名片优先", parsed[1]?.card === "他" && parsed[1]?.nickname === "小鱼");
  check("角色保留", parsed[1]?.role === "owner" && parsed[2]?.role === "admin");

  console.log("\n=== ② 名册落库（整群覆盖） ===");
  const db = new DatabaseSync(tmpDb);
  // 先塞一批旧的（模拟上次同步里有 20 个路人）
  const old = Array.from({ length: 20 }, (_, i) => ({ qqId: String(900000 + i), card: `路人${i}`, nickname: "", role: "member" }));
  saveGroupMembers(db, GROUP, [...parsed, ...old]);
  check("第一次同步后 23 人", listGroupMembers(db, GROUP).length === 23, `${listGroupMembers(db, GROUP).length}`);

  // 第二次同步人数变少（有人退群）→ 名册应该正好是这 3 个
  const after = saveGroupMembers(db, GROUP, parsed);
  const rows = listGroupMembers(db, GROUP);
  check("退群的人从名册里消失（整群覆盖，不是只增）", rows.length === 3, `${after.count} 人`);
  check("名册里能查到他", rows.some((r) => r.qqId === "10002"));

  console.log("\n=== ③ 提示词里那一行群情 ===");
  const line = rosterLine(db, GROUP, ["他", "某人"]);
  console.log(`  ${line}`);
  check("说了总人数", line.includes("共 3 人"));
  check("列了名字", line.includes("他") && line.includes("某人"));
  check("点了「谁开过口」", line.includes("开过口"));

  // 人多的群：不把 60 个名字全塞进去
  const many = Array.from({ length: 60 }, (_, i) => ({ qqId: String(800000 + i), card: `人${i}`, nickname: "", role: "member" }));
  saveGroupMembers(db, 123456, many);
  const longLine = rosterLine(db, 123456, []);
  check("人多时只给前 40 个 + 提示调工具", longLine.includes("共 60 人") && longLine.includes("group_members") && (longLine.match(/人\d+/g)?.length ?? 0) <= 40);

  console.log("\n=== ④ 工具 group_members ===");
  const reg = new ToolRegistry();
  registerRosterTools(reg, { db });
  const r = await reg.call("group_members", { group: GROUP });
  console.log(r.text.split("\n").slice(0, 4).map((l) => `  ${l}`).join("\n"));
  check("工具说不出错", r.ok);
  check("工具能列出全部成员", r.text.includes("某人") && r.text.includes("共 3 人"));
  const adm = await reg.call("group_members", { group: GROUP, onlyAdmins: true });
  check("能只看管理", adm.ok && adm.text.includes("群主") && !adm.text.includes("路人"));

  // 名册是「学一次」的：读过就不再拉，只有显式 action=sync 才动
  console.log("\n=== ④b 只学一次 / 按需刷新 ===");
  check("已经有名册（hasRoster 为真，启动时不会再拉）", hasRoster(db, GROUP));
  const noHook = await reg.call("group_members", { group: GROUP, action: "sync" });
  check("没有 OneBot 连接时 sync 会说清原因", noHook.ok === false && noHook.text.includes("OneBot"), noHook.text.slice(0, 30));

  const reg2 = new ToolRegistry();
  registerRosterTools(reg2, {
    db,
    refresh: async (gid) => {
      const fresh = [
        { qqId: "10001", card: "他", nickname: "小鱼", role: "owner" },
        { qqId: "10002", card: "某某", nickname: "某某", role: "admin" },
        { qqId: "532395010", card: "兰因絮果", nickname: "", role: "member" },
        { qqId: "10003", card: "新来的", nickname: "", role: "member" },
      ];
      saveGroupMembers(db, gid, fresh);
      return fresh.length;
    },
  });
  const synced = await reg2.call("group_members", { group: GROUP, action: "sync" });
  console.log(`  ${synced.text}`);
  check("action=sync 真去拉了一次并更新", synced.ok && synced.text.includes("4 人"));
  check("更新后名册里多了新来的", listGroupMembers(db, GROUP).some((m) => m.name === "新来的"));
  db.close();

  console.log("\n=== ⑤ 真的走 handle：群消息里能看到群情 ===");
  const cfg = {
    ...loadBotConfig(),
    dataDir: tmpDir,
    memoryDb: tmpDb,
    toolsEnabled: false,
    idleSleepMinutes: 0,
    idleSleepHours: 0,
    dailySleepWindow: null,
  };
  const seen: Array<Array<{ role: string; content: string }>> = [];
  let lastReply = "";
  const svc = new BotService(cfg, {
    replyAdapter: {
      complete: async (messages: Array<{ role: string; content: string }>) => {
        seen.push(messages);
        return "在的";
      },
    } as never,
  });
  lastReply = String(
    (await svc.handle({
      userId: 10001,
      userName: "他",
      sessionId: "g",
      text: "群里都有谁",
      isGroup: true,
      groupId: GROUP,
      mentioned: false,
      selfId: 30001,
    } as never)) ?? "",
  );
  const sys = String(seen[0]?.[0]?.content ?? "");
  const scene = sys.slice(sys.indexOf("【这里是哪儿】"), sys.indexOf("【谁是谁】"));
  console.log(scene.split("\n").slice(0, 6).map((l) => `  ${l}`).join("\n"));
  check("提示词里有【这里是哪儿】", sys.includes("【这里是哪儿】"));
  check("提示词里有群人数和成员", scene.includes("共 4 人") && scene.includes("新来的"));
  // 短回复（<4 字）会触发宽松重试；那条路以前因为 recallQuery 越界直接炸成兜底句
  check("短回复走重试不炸（recallQuery 作用域 bug 已修）", lastReply === "在的", `回复=${lastReply.slice(0, 20)}`);
  svc.close();
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
