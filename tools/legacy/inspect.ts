import { DEFAULT_CONFIG, withOverrides } from "../src/config.ts";
import { runFullEval } from "../src/eval.ts";
import { describeEvent, recall } from "../src/recall.ts";

const budget = Number(process.argv[2] ?? 200000);
const query = process.argv[3] ?? "妈妈的手术结果怎么样";
const cfg = withOverrides(DEFAULT_CONFIG, { contextBudgetTokens: budget });
const { db } = runFullEval({
  dbPath: `./data/inspect${budget}.db`,
  datasetPath: "eval/dataset.jsonl",
  probesPath: "eval/probes.json",
  seedsPath: "data/seed-anchors.json",
  cfg,
});

const hits = db.prepare("SELECT id, tier, title, core_fragment FROM events WHERE title LIKE '%良性%' OR core_fragment LIKE '%良性%'").all();
console.log("良性 events:", JSON.stringify(hits));
for (const h of hits) {
  console.log(
    "anchors:",
    JSON.stringify(db.prepare("SELECT a.name, ea.weight FROM event_anchors ea JOIN anchors a ON a.id=ea.anchor_id WHERE ea.event_id=?").all(String(h.id))),
  );
}

const res = recall(db, cfg, query, {});
console.log(`\nseeds: ${res.seeds.map((s) => s.name).join(",")}`);
console.log("factual:");
for (const c of res.factual) {
  console.log(" ", JSON.stringify(c.breakdown), c.event.tier, describeEvent(c.event).slice(0, 40));
}
console.log("\nprob table:");
for (const t of res.probabilityTable) console.log(" ", t.probability, t.title);

