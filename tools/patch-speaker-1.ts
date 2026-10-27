import { readFileSync, writeFileSync } from "node:fs";

// ── 1) db：给 turns 和 events 加 speaker_id ──
{
  const p = "src/db.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes('"speaker_id"')) {
    s = s.replace(
      '  ensureColumn(db, "events", "context_kinds", "TEXT NOT NULL DEFAULT \'[]\'");',
      [
        '  ensureColumn(db, "events", "context_kinds", "TEXT NOT NULL DEFAULT \'[]\'");',
        '  // 共享记忆下要知道这条是谁的事：检索时优先匹配当前说话人',
        '  ensureColumn(db, "events", "speaker_id", "TEXT NOT NULL DEFAULT \'\'");',
        '  ensureColumn(db, "turns", "speaker_id", "TEXT NOT NULL DEFAULT \'\'");',
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("db：speaker_id 列已加");
  }
}

// ── 2) extract：ingestTurns 带上 speakerId ──
{
  const p = "src/extract.ts";
  let s = readFileSync(p, "utf8");
  s = s.replace(
    '"INSERT INTO turns(id, seq, day, ts, role, text, processed, created_at) VALUES(?,?,?,?,?,?,0,?)"',
    '"INSERT INTO turns(id, seq, day, ts, role, text, speaker_id, processed, created_at) VALUES(?,?,?,?,?,?,?,0,?)"',
  );
  writeFileSync(p, s, "utf8");
  console.log("extract：ingest SQL 已加 speaker_id");
}
