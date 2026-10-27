// 验证自画像工具：只给目录、不给全文；能看到今天花了多少钱。
//
// 用 data/tmp-verify-self.db（memory.db 的副本），不污染真库。
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { loadBotConfig } from "../src/bot/config.ts";
import { BotService } from "../src/bot/service.ts";

const SRC = "data/memory.db";
const TMP = "data/tmp-verify-self.db";
for (const p of [TMP, `${TMP}-wal`, `${TMP}-shm`]) if (existsSync(p)) rmSync(p);
copyFileSync(SRC, TMP);

const cfg = { ...loadBotConfig(), memoryDb: TMP };
const svc = new BotService(cfg);

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `　${detail}` : ""}`);
  if (!ok) fail += 1;
};

const reg = svc.toolRegistry()!;
check("工具注册表里有 self_status", reg.names().includes("self_status"));

const r = await reg.call("self_status", {});
console.log("\n——— 她看到的 ———");
console.log(r.text);
console.log("——— 完 ———\n");

check("返回成功", r.ok);
check("有【我是谁】", r.text.includes("【我是谁】"));
check("有【我现在】", r.text.includes("【我现在】"));
check("有【今天】和花费", /【今天】/.test(r.text) && /花 ¥/.test(r.text));
check("给了取全文的入口", r.text.includes("persona(action=get)"));

// 关键：不能把全文吐出来（人格 2100 字、说话规矩 890 字都不该出现）
const persona = await reg.call("persona", { action: "get" });
const firstLine = String(persona.text).split("\n").find((l) => l.trim().length > 20) ?? "";
check("没有把人格全文吐出来", firstLine.length === 0 || !r.text.includes(firstLine.slice(0, 30)));

const len = [...r.text].length;
check(`体积够小（${len} 字，全量要 4500 字）`, len < 700, `实际 ${len} 字`);

svc.close();
for (const p of [TMP, `${TMP}-wal`, `${TMP}-shm`]) if (existsSync(p)) rmSync(p);

console.log(fail === 0 ? "全部通过" : `${fail} 项没过`);
process.exitCode = fail === 0 ? 0 : 1;
