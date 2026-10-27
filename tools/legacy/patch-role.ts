import { readFileSync, writeFileSync } from "node:fs";

// 1) event_anchors 加 role 列
{
  const p = "src/db.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes('event_anchors", "role"')) {
    const anchor = '  ensureColumn(db, "events", "mentions", "INTEGER NOT NULL DEFAULT 1");';
    s = s.replace(
      anchor,
      [
        anchor,
        "  // 一件事里的角色不止一个：谁说的、说的是谁、提到谁",
        '  ensureColumn(db, "event_anchors", "role", "TEXT NOT NULL DEFAULT \'mentioned\'");',
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("db：role 列已加");
  }
}

// 2) people.ts 加按角色挂人
{
  const p = "src/people.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("linkEventPerson")) {
    s += `

/**
 * 把一件事挂到一个人身上，并写明**是什么角色**。
 *
 * 一件事里不止一个人：谁说的、说的是谁、只是被提到。
 * 光挂一条边，事后就分不清「林溪说过这话」和「这话是说林溪的」。
 */
export function linkEventPerson(
  db: DatabaseSync,
  eventId: string,
  personAnchorId: string,
  role: "speaker" | "subject" | "mentioned",
  weight = 1,
): void {
  if (!eventId || !personAnchorId) return;
  try {
    db.prepare(
      \`INSERT INTO event_anchors (event_id, anchor_id, weight, role) VALUES (?,?,?,?)
       ON CONFLICT(event_id, anchor_id) DO UPDATE SET
         role = CASE
           WHEN event_anchors.role = 'speaker' THEN 'speaker'
           WHEN excluded.role = 'speaker' THEN 'speaker'
           WHEN event_anchors.role = 'subject' THEN 'subject'
           ELSE excluded.role
         END,
         weight = MAX(event_anchors.weight, excluded.weight)\`,
    ).run(eventId, personAnchorId, weight, role);
  } catch {
    // 挂不上不影响记忆本身
  }
}

/** 给一个 QQ 号找到（必要时建出）他的人节点 */
export function personAnchorFor(db: DatabaseSync, qqId: string | number, displayName = ""): string | null {
  const p = ensurePerson(db, qqId, displayName);
  return p ? p.anchorId : null;
}
`;
    writeFileSync(p, s, "utf8");
    console.log("people：linkEventPerson 已加");
  }
}
