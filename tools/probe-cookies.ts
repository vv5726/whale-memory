/**
 * 从 Edge/Chrome 的 cookie 库里把 bilibili 的 SESSDATA 找出来。
 *
 * 注意：新版本浏览器（127+）用 App-Bound 加密，前缀是 v20，光靠 DPAPI 解不开。
 * 这里先把情况摸清楚：有没有这条 cookie、用的是哪种加密。
 */
import { copyFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const src = process.argv[2] ?? "";
const tmp = "data/.cookies-probe.db";

if (!existsSync(src)) {
  console.log("找不到 cookie 库");
  process.exit(1);
}

copyFileSync(src, tmp);
const db = new DatabaseSync(tmp);

const rows = db
  .prepare("SELECT host_key, name, encrypted_value, length(encrypted_value) AS len FROM cookies WHERE host_key LIKE '%bilibili%'")
  .all() as Array<{ host_key: string; name: string; encrypted_value: unknown; len: number }>;

console.log(`bilibili 相关 cookie 共 ${rows.length} 条`);
for (const r of rows) {
  const buf = r.encrypted_value as Uint8Array | null;
  const prefix = buf && buf.length >= 3 ? Buffer.from(buf.slice(0, 3)).toString("utf8") : "(空)";
  console.log(`  ${r.host_key.padEnd(24)} ${String(r.name).padEnd(20)} ${r.len} 字节  前缀=${prefix}`);
}
db.close();
