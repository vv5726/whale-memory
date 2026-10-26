import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { newId } from "./util.ts";
import { dayKey } from "./util.ts";
import { analyzeAffect } from "./affect.ts";

/**
 * 「关于某个人是谁」。
 *
 * 和记忆不同：记忆记「发生过什么事」，这个记「他是谁」——
 * 性格、偏好、雷区、跟他什么关系。
 *
 * 关键：**挂在 QQ 号上**。名字会改，号不会。
 * 这样群里好几个人说话，也能分清哪条档案是谁的。
 */
export function aboutPerson(
  db: DatabaseSync,
  input: { person: string; content: string; speakerId?: string },
): { ok: boolean; text: string } {
  const content = String(input.content ?? "").trim();
  if (content.length < 3) return { ok: false, text: "太短了，写清楚点" };

  // 先解析这个人：名字 → QQ 号
  let qqId = String(input.speakerId ?? "").trim();
  let name = String(input.person ?? "").trim();

  if (!qqId && name) {
    const row = db
      .prepare("SELECT qq_id, display_name FROM people WHERE display_name = ? OR qq_id = ? LIMIT 1")
      .get(name, name) as { qq_id: string; display_name: string } | undefined;
    if (row) {
      qqId = row.qq_id;
      name = row.display_name || name;
    } else {
      // 模糊匹配
      const all = db.prepare("SELECT qq_id, display_name FROM people").all() as Array<{
        qq_id: string;
        display_name: string;
      }>;
      const hit = all.find((p) => p.display_name && (p.display_name.includes(name) || name.includes(p.display_name)));
      if (hit) {
        qqId = hit.qq_id;
        name = hit.display_name;
      }
    }
  }

  if (!qqId) {
    const names = (db.prepare("SELECT display_name FROM people WHERE display_name <> ''").all() as Array<{
      display_name: string;
    }>).map((r) => r.display_name);
    return { ok: false, text: `不认识「${name}」。我知道的人：${names.join("、") || "（还没有）"}` };
  }

  const title = `${name || qqId}：${content.slice(0, 20)}`;
  const affect = analyzeAffect(content);
  const now = Date.now();

  db.prepare(
    `INSERT INTO events (
      id, day, ts, period_label, tier, stage, title, detail, affect_valence, affect_arousal, affect_tags, affect_summary,
      pinned, key_facts, strength, mentions, derived_from, context_kinds, kind,
      size_tokens, archived, source_turn_id, created_at, updated_at, speaker_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    newId("ev"),
    dayKey(now),
    now,
    "白天",
    "detailed",
    0,
    title.slice(0, 60),
    content,
    affect.valence,
    affect.arousal,
    JSON.stringify(affect.tags ?? []),
    affect.summary ?? null,
    1, // 关于人的档案默认钉住：不参与下沉、不进取舍
    "[]",
    1.5,
    1,
    "[]",
    JSON.stringify(["about-person"]),
    "user",
    Math.ceil(content.length / 2),
    0,
    null,
    now,
    now,
    qqId,
  );

  // 挂到那个人身上：这样「想到他」时能顺带想起这条档案
  try {
    const person = db.prepare("SELECT anchor_id FROM people WHERE qq_id = ?").get(qqId) as { anchor_id: string } | undefined;
    if (person?.anchor_id) {
      const eventId = db.prepare("SELECT id FROM events WHERE title = ? ORDER BY ts DESC LIMIT 1").get(title.slice(0, 60)) as
        | { id: string }
        | undefined;
      if (eventId) {
        db.prepare(
          "INSERT OR IGNORE INTO event_anchors (event_id, anchor_id, weight, role) VALUES (?,?,?, 'subject')",
        ).run(eventId.id, person.anchor_id, 2);
        db.prepare("UPDATE anchors SET hits = hits + 1, last_seen = ? WHERE id = ?").run(now, person.anchor_id);
      }
    }
  } catch {
    // 挂不上不影响档案本身
  }

  return { ok: true, text: `记下了关于「${name || qqId}」的：${content.slice(0, 30)}` };
}

export function registerAboutPersonTool(
  registry: ToolRegistry,
  hooks: { about?: (input: { person: string; content: string }) => { ok: boolean; text: string } },
): void {
  const tool: ToolDefinition = {
    name: "memory_about_person",
    description:
      "记「某个人是谁」：他的性格、偏好、雷区、跟你的关系。挂在他身上，以后跟他说话时会被一直带在眼前；想到他时也能顺带想起来。\n\n⚠️ 只写你真的看出来、或他明说过的。不许编——不知道就别写，宁可空着。记事情用 memory_save，记人用这个。",
    parameters: {
      type: "object",
      properties: {
        person: { type: "string", description: "谁：名字或 QQ 号" },
        content: { type: "string", description: "关于他的一条：性格/偏好/雷区/关系，一条只写一件事" },
      },
      required: ["person", "content"],
    },
    handler: async (args) => {
      if (!hooks.about) return { ok: false, text: "现在记不了" };
      return hooks.about({ person: String(args.person ?? ""), content: String(args.content ?? "") });
    },
  };
  registry.register(tool);
}
