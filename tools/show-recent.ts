import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");
const rows = db.prepare("SELECT role, text FROM turns ORDER BY seq DESC LIMIT 24").all() as Array<{
  role: string;
  text: string;
}>;

for (const r of rows.reverse()) {
  const who = r.role === "user" ? "他" : "凝";
  const t = String(r.text).replace(/\s+/g, " ");
  console.log(`${who}：${t.length > 180 ? `${t.slice(0, 180)}…` : t}`);
}
db.close();
