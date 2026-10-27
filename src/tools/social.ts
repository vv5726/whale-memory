import type { DatabaseSync } from "node:sqlite";
import { recordOwnNote } from "../notes.ts";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 两件事：
 *  1. 谁能私聊（anchors.can_dm）她自己能看、能改、能跟 SnowLuma 好友列表对账
 *  2. 发了表情包记一笔轻记忆（低分，睡眠时容易被压缩下去，不挤占重要记忆）
 *
 * 2026-10-27：can_dm 的 list/set/sync 合成一个带 action 的，少占工具清单。
 */
export function registerSocialTools(
  registry: ToolRegistry,
  hooks: { db: DatabaseSync; listFriends?: () => Promise<number[]> },
): void {
  const canDm: ToolDefinition = {
    name: "can_dm",
    description:
      "管「谁能私聊」——can_dm=1 是好友、能直接找他；0 只能去群里找。\n\naction：list 看全部、set 改某个人、sync 按真实好友列表对账（加/删好友之后跑一次）。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "set", "sync"], description: "list 看 / set 改一个人 / sync 对账" },
        person: { type: "string", description: "action=set 时填：名字或 QQ 号" },
        canDm: { type: "number", description: "action=set 时填：1 能私聊 / 0 不能" },
      },
      required: ["action"],
    },
    handler: async (args) => {
      const action = String(args.action ?? "list");

      if (action === "list") {
        const rows = hooks.db
          .prepare("SELECT name, external_id, can_dm FROM anchors WHERE external_id != '' ORDER BY can_dm DESC, name")
          .all() as Array<{ name: string; external_id: string; can_dm: number }>;
        if (rows.length === 0) return { ok: true, text: "还没有记过任何人的号。" };
        const yes = rows.filter((r) => Number(r.can_dm) === 1);
        const no = rows.filter((r) => Number(r.can_dm) !== 1);
        const fmt = (r: { name: string; external_id: string }) => `${r.name}(${r.external_id})`;
        return {
          ok: true,
          text: [
            `能私聊（${yes.length}）：${yes.map(fmt).join("、") || "无"}`,
            `只能群里找（${no.length}）：${no.map(fmt).join("、") || "无"}`,
            "",
            "改：action=set + person + canDm(1/0)；加了好友就跑 action=sync 按真实好友列表对账。",
          ].join("\n"),
        };
      }

      if (action === "set") {
        const who = String(args.person ?? "").trim();
        const val = Number(args.canDm) === 1 ? 1 : 0;
        if (!who) return { ok: false, text: "要给谁设？填 person（名字或 QQ 号）" };
        const num = (who.match(/\d{5,}/) ?? [])[0] ?? "";
        const r = num
          ? hooks.db.prepare("UPDATE anchors SET can_dm = ? WHERE external_id = ?").run(val, num)
          : hooks.db.prepare("UPDATE anchors SET can_dm = ? WHERE name = ?").run(val, who);
        if (Number(r.changes) === 0) return { ok: false, text: `没找到「${who}」的锚点（先让人记住他，或者直接给 QQ 号）` };
        return { ok: true, text: `改好了：${who} → ${val === 1 ? "能私聊" : "只能群里找"}（${r.changes} 个锚点）` };
      }

      if (action === "sync") {
        if (!hooks.listFriends) return { ok: false, text: "拿不到好友列表（没连 OneBot）" };
        let friends: number[] = [];
        try {
          friends = await hooks.listFriends();
        } catch (e) {
          return { ok: false, text: `拉好友列表失败：${e instanceof Error ? e.message : e}` };
        }
        const rows = hooks.db.prepare("SELECT id, external_id, can_dm FROM anchors WHERE external_id != ''").all() as Array<{
          id: string;
          external_id: string;
          can_dm: number;
        }>;
        let changed = 0;
        for (const r of rows) {
          const want = friends.includes(Number(r.external_id)) ? 1 : 0;
          if (Number(r.can_dm) !== want) {
            hooks.db.prepare("UPDATE anchors SET can_dm = ? WHERE id = ?").run(want, r.id);
            changed++;
          }
        }
        return { ok: true, text: `对账完成：好友 ${friends.length} 个，改了 ${changed} 个锚点的 can_dm。` };
      }

      return { ok: false, text: `不认识的 action：${action}（只有 list / set / sync）` };
    },
  };
  registry.register(canDm);

  const stickerMemo: ToolDefinition = {
    name: "sticker_memo",
    description:
      "发完表情包之后记一笔轻记忆：给谁发的、什么情绪。分值低（2 分），睡眠时容易被压缩下去，不会挤占重要记忆。",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "发给谁（名字或群号）" },
        tag: { type: "string", description: "什么情绪，比如「开心」「无语」" },
      },
      required: ["to", "tag"],
    },
    handler: async (args) => {
      const to = String(args.to ?? "").trim();
      const tag = String(args.tag ?? "").trim();
      if (!to || !tag) return { ok: false, text: "要写清发给谁、什么情绪" };
      try {
        recordOwnNote(hooks.db, `给${to}发了一张「${tag}」的表情包`, Date.now());
        return { ok: true, text: `记下了：给${to}发了一张「${tag}」的表情包` };
      } catch (e) {
        return { ok: false, text: `没记上：${e instanceof Error ? e.message : e}` };
      }
    },
  };
  registry.register(stickerMemo);
}
