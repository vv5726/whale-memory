import { DatabaseSync } from "node:sqlite";
import { recallContext } from "./.dsh-test-recall.mjs";
import { homedir } from "node:os";
import { join } from "node:path";

const dbPath = join(homedir(), ".dsh", "whale-memory", "memory.db");
const db = new DatabaseSync(dbPath, { readOnly: true });
const block = recallContext(db, "小雨是什么意思", { limit: 2 });
console.log(block ? block.split("\n").map((l) => `  ${l.slice(0, 95)}`).join("\n") : "（空）");
db.close();
