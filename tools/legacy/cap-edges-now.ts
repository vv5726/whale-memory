// 瀵规寮忓簱鎵ц涓€娆¤竟涓婇檺锛堝厛澶囦唤锛夛細娓╁眰鍒犲埌 25%锛屽喎灞傝秴 2,000 鎵嶅姩锛岀儹灞備笉纰?import { copyFileSync, existsSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { capEdgesByTier } from "../src/anchors.ts";

const dbPath = "data/memory.db";
const backup = "data/backup-before-edge-cap.db";
if (!existsSync(backup)) {
  copyFileSync(dbPath, backup);
  console.log(`澶囦唤锛?{backup}锛?{(statSync(backup).size / 1024 / 1024).toFixed(1)} MB锛塦);
}
const size = () => (statSync(dbPath).size / 1024 / 1024).toFixed(1);
console.log(`鎵ц鍓嶏細${size()} MB锛宔dges ${Number((new DatabaseSync(dbPath).prepare("SELECT COUNT(*) AS n FROM edges").get() as { n: number }).n)}`);

const db = new DatabaseSync(dbPath);
const r = capEdgesByTier(db, { warmCap: 20_000, coldCap: 2_000, keepRatio: 0.25 });
console.log(`娓╄竟鍒?${r.warmDeleted}锛屽喎杈瑰垹 ${r.coldDeleted}锛涚幇鍦?edges ${Number((db.prepare("SELECT COUNT(*) AS n FROM edges").get() as { n: number }).n)} 鏉);
db.exec("VACUUM");
db.close();
console.log(`VACUUM 涔嬪悗锛?{size()} MB`);
