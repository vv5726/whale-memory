import { openDb } from "../src/db.ts";

const db = openDb("data/memory.db");

const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as Array<{ name: string }>).map(
  (r) => r.name,
);
console.log("表:", tables.join(", "));
console.log("events 列:", (db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>).map((c) => c.name).join(","));
console.log("event_anchors 列:", (db.prepare("PRAGMA table_info(event_anchors)").all() as Array<{ name: string }>).map((c) => c.name).join(","));
console.log("edges 列:", (db.prepare("PRAGMA table_info(edges)").all() as Array<{ name: string }>).map((c) => c.name).join(","));
console.log("anchors 列:", (db.prepare("PRAGMA table_info(anchors)").all() as Array<{ name: string }>).map((c) => c.name).join(","));
db.close();
