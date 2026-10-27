import { readFileSync, writeFileSync } from "node:fs";

// ── 1) sleep 里回填：LLM 抽出来的事件没有 source_turn_id，改用「那天是谁在说话」兜底 ──
{
  const p = "src/sleep.ts";
  let s = readFileSync(p, "utf8");
  const old = `        db.exec(\`
          UPDATE events
          SET speaker_id = (
            SELECT t.speaker_id FROM turns t WHERE t.id = events.source_turn_id
          )
          WHERE (speaker_id IS NULL OR speaker_id = '')
            AND source_turn_id IS NOT NULL
            AND source_turn_id <> ''
        \`);`;
  const neu = `        // ① 有来源对话的，直接从对话上取（最准）
        db.exec(\`
          UPDATE events
          SET speaker_id = (
            SELECT t.speaker_id FROM turns t WHERE t.id = events.source_turn_id
          )
          WHERE (speaker_id IS NULL OR speaker_id = '')
            AND source_turn_id IS NOT NULL
            AND source_turn_id <> ''
        \`);

        // ② 没有来源对话的（LLM 抽取出来的都是这种），用「那天是谁在说话」兜底。
        //    之前只做了 ①，所以绝大部分记忆的说话人一直空着。
        db.exec(\`
          UPDATE events
          SET speaker_id = COALESCE(
            (SELECT t.speaker_id FROM turns t
              WHERE t.day = events.day AND t.role = 'user' AND t.speaker_id <> ''
              ORDER BY t.seq DESC LIMIT 1),
            ''
          )
          WHERE (speaker_id IS NULL OR speaker_id = '')
        \`);`;
  if (s.includes(old)) {
    s = s.replace(old, neu);
    writeFileSync(p, s, "utf8");
    console.log("sleep：说话人回填已加强");
  } else {
    console.log("sleep：锚点没匹配");
  }
}

// ── 2) memory_about / memory_stats 里让它看得见这个字段 ──
{
  const p = "src/tools/selfmemory.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes("谁的事")) {
    s = s.replace(
      "还有「同义合并」",
      [
        "每条记忆还带一个「说话人」——它记的是「这是谁的事」。",
        "共享同一个库的时候，这决定了「你妈」和「他的妈妈」会不会串。",
        "",
        "还有「同义合并」",
      ].join("\n"),
    );
    s = s.replace(
      "        `锚点 ${anchors} 个，关系 ${edges} 条　钉住 ${pinned} 条　冷存储 ${cold} 条`,",
      [
        "        `锚点 ${anchors} 个，关系 ${edges} 条　钉住 ${pinned} 条　冷存储 ${cold} 条`,",
        "        `带说话人的记忆 ${withSpeaker}/${total} 条`,",
      ].join("\n"),
    );
    s = s.replace(
      "      const cold = count(db, \"SELECT COUNT(*) AS c FROM cold_archive\");",
      [
        "      const cold = count(db, \"SELECT COUNT(*) AS c FROM cold_archive\");",
        "      const withSpeaker = count(db, \"SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND speaker_id <> ''\");",
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("selfmemory：能看到说话人覆盖情况了");
  }
}
