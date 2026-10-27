/**
 * 验证「人 → 锚点 → 角色 → 内容」这一跳真的接上了：
 *   · people 表和锚点绑好（不再悬空、号码锚点和名字锚点是同一个人）
 *   · event_anchors.role 里有 speaker（谁说的）
 *   · 提示词里把「他说过的 / 关于他的」挂在这个人下面
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BotService } from "../src/bot/service.ts";
import { loadBotConfig } from "../src/bot/config.ts";
import { anchorsOf, ensureSelfPerson, linkPeopleToAnchors, personCard, resolveSpeakerAnchor, resolveViaEvidence, syncSpeakerRoles } from "../src/person-graph.ts";
import { buildV3Messages } from "../src/llm/extract-v3.ts";

const tmpDir = "data/tmp-person-cards";
const tmpDb = join(tmpDir, "memory.db");

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail++;
};

try {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  copyFileSync("data/memory.db", tmpDb);
  for (const f of ["tuning.json", "self.md", "speech-rules.md"]) {
    if (existsSync(join("data", f))) copyFileSync(join("data", f), join(tmpDir, f));
  }

  const db = new DatabaseSync(tmpDb);
  const countRole = (role: string) =>
    Number((db.prepare("SELECT COUNT(*) c FROM event_anchors WHERE role = ?").get(role) as { c: number }).c);

  console.log("=== ① 绑定 + 角色（跑两遍验幂等） ===");
  const before = countRole("speaker");
  // 她自己也是 people 里的人（线上由 BotService 构造时调，等价于这一行）
  ensureSelfPerson(db, "30001", "凝");
  const l1 = linkPeopleToAnchors(db);
  const r1 = syncSpeakerRoles(db);
  const l2 = linkPeopleToAnchors(db);
  const r2 = syncSpeakerRoles(db);
  console.log(`  第一遍：${l1.people} 人，别名 +${l1.aliasAdded}，修悬空 ${l1.fixed}，speaker ${r1.links} 条`);
  console.log(`  第二遍：别名 +${l2.aliasAdded}，修悬空 ${l2.fixed}，speaker ${r2.links} 条`);

  check("库里存在 speaker 角色（以前是 0）", countRole("speaker") > 0, `${before} → ${countRole("speaker")}`);
  check("第二遍不再改别名（幂等）", l2.aliasAdded === 0, `${l2.aliasAdded}`);
  check("第二遍不再修悬空（幂等）", l2.fixed === 0, `${l2.fixed}`);
  check("第二遍 speaker 数不变（幂等）", r2.links === r1.links, `${r1.links} vs ${r2.links}`);

  const dangling = Number(
    (db.prepare("SELECT COUNT(*) c FROM people WHERE anchor_id NOT IN (SELECT id FROM anchors)").get() as { c: number }).c,
  );
  check("people.anchor_id 没有悬空", dangling === 0, `${dangling} 个`);
  check("每个有名的人都有 external_id", Number((db.prepare("SELECT COUNT(*) c FROM anchors WHERE external_id <> ''").get() as { c: number }).c) >= 5);

  console.log("\n=== ② 一个人的卡：他是谁 + 他说过什么 ===");
  const wx = personCard(db, "10002", 2);
  console.log(`  ${wx?.name}（${wx?.qqId}）说过 ${wx?.spoke.length} 条、关于他 ${wx?.about.length} 条`);
  console.log(`  spoke: ${JSON.stringify(wx?.spoke)}`);
  console.log(`  about: ${JSON.stringify(wx?.about)}`);
  check("某人的卡拿得到", !!wx);
  check("某人有「他说过的」", (wx?.spoke.length ?? 0) > 0);
  check("某人有「关于他的」", (wx?.about.length ?? 0) > 0);
  check("名字锚点和号码锚点归到一个人", anchorsOf(db, "10002").length >= 2, `${anchorsOf(db, "10002").length} 个锚点`);

  const self = personCard(db, "30001", 2);
  check("它自己的号也有卡（它也是这段人生里的人）", !!self, self?.name);

  console.log("\n=== ②b 「谁说的」的三种叫法都要认出人，代词才归属不了 ===");
  const rq = resolveSpeakerAnchor(db, "10001");
  const rname = resolveSpeakerAnchor(db, "他");
  const rself = resolveSpeakerAnchor(db, "凝");
  const rselfQq = resolveSpeakerAnchor(db, "30001");
  const rpron = resolveSpeakerAnchor(db, "他");
  console.log(`  10001 → ${rq.anchorId ?? "null"}（${rq.kind}）`);
  console.log(`  他         → ${rname.anchorId ?? "null"}（${rname.kind}）`);
  console.log(`  凝         → ${rself.anchorId ?? "null"}（${rself.kind}）`);
  console.log(`  他         → ${rpron.anchorId ?? "null"}（${rpron.kind}）`);
  check("号码 → 人", rq.kind === "qq" && !!rq.anchorId);
  check("名字 他 → 同一个人（不是脏值）", rname.anchorId === rq.anchorId && rname.kind === "name");
  check("自称 凝 → 她自己", rself.anchorId === rselfQq.anchorId && rself.kind === "name");
  check("代词 他 → 归属不了（如实为 null）", rpron.anchorId === null && rpron.kind === "pronoun");

  // 代词不是死路：事件自己的 evidence 指向的对话里有真实说话人，能倒回去
  const pronounEvents = db
    .prepare("SELECT id, evidence FROM events WHERE speaker_id = '他' AND COALESCE(archived,0)=0")
    .all() as Array<{ id: string; evidence: string | null }>;
  let recoverable = 0;
  for (const e of pronounEvents) if (resolveViaEvidence(db, e.evidence)) recoverable++;
  console.log(`  库里「他」的事件 ${pronounEvents.length} 条，靠证据能倒回真人的 ${recoverable} 条`);
  check("「他」的事件能靠证据倒回人（不是瞎猜）", pronounEvents.length === 0 || recoverable === pronounEvents.length);

  const roleSync = syncSpeakerRoles(db);
  console.log(`  同步后：speaker ${roleSync.links} 条，靠证据倒回 ${roleSync.recovered}，仍归属不了 ${roleSync.pronouns}`);
  check("倒回的事件真的被修成 QQ 号", roleSync.recovered > 0 || pronounEvents.length === 0);
  const stillPronoun = Number(
    (db.prepare("SELECT COUNT(*) c FROM events WHERE speaker_id = '他' AND COALESCE(archived,0)=0").get() as { c: number }).c,
  );
  check("修完库里不再有「他」当说话人", stillPronoun === 0, `${stillPronoun} 条`);

  // 抽取提示词：不许再接「他」这个标签
  const v3 = buildV3Messages(
    "2026-10-26",
    [
      { id: "t1", role: "user", text: "你好", speakerId: "10001" },
      { id: "t2", role: "user", text: "没标说话人的一句" },
    ],
    { user: "10001", assistant: "30001" },
  );
  const v3sys = v3[0]!.content;
  const v3user = v3[1]!.content;
  check("没标说话人的不再写成「他」", !/\] 他:/.test(v3user), v3user.split("\n").pop()?.slice(0, 40));
  check("标了「（没标说话人）」", v3user.includes("（没标说话人）"));
  check("提示词明说别写代词", v3sys.includes("绝对不要写「他」"));
  check("提示词里的「谁是谁」不再重复", !v3sys.includes("10001 就是 10001"));

  const selfPeople = db.prepare("SELECT display_name FROM people WHERE qq_id = '30001'").get() as
    | { display_name: string }
    | undefined;
  check("people 里有凝了", selfPeople?.display_name === "凝", selfPeople?.display_name);
  check("她自己说过的事被记上了", (self?.spoke.length ?? 0) > 0);

  const speakerBySelf = Number(
    (db
      .prepare(
        `SELECT COUNT(*) c FROM event_anchors ea JOIN people p ON p.anchor_id = ea.anchor_id
         WHERE ea.role='speaker' AND p.qq_id='30001'`,
      )
      .get() as { c: number }).c,
  );
  check("她自己的 12 条发言归到她名下", speakerBySelf > 0, `${speakerBySelf} 条`);
  db.close();

  console.log("\n=== ③ 提示词里真的挂在人名下面 ===");
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
  const adapter = {
    complete: async (messages: Array<{ role: string; content: string }>) => {
      seen.push(messages);
      return "某人在群里，我这就去问他";
    },
  };
  const svc = new BotService(cfg, { replyAdapter: adapter as never });
  await svc.handle({
    userId: 10001,
    userName: "他",
    sessionId: "g",
    text: "@10002",
    isGroup: true,
    groupId: 20003,
    mentioned: false,
    selfId: 30001,
  } as never);

  const sys = String(seen[0]?.[0]?.content ?? "");
  const start = sys.indexOf("【谁是谁】");
  const block = sys.slice(start, sys.indexOf("消息里的 @123456", start));
  console.log(block.split("\n").map((l) => `  ${l}`).join("\n"));

  check("提示词里有这个人", block.includes("10002 = 某人"));
  check("这个人下面挂了「他说过的」", block.includes("他说过的："));
  check("这个人下面挂了「关于他的」", block.includes("关于他的："));
  check("挂的是真内容（标题不是空的）", /他说过的：「[^」]{2,}/.test(block));
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
