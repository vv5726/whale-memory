import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const path = "D:/NapCat/config/onebot11_30001.json";
copyFileSync(path, `${path}.bak`);

const cfg = JSON.parse(readFileSync(path, "utf8"));
cfg.network ??= {};
cfg.network.websocketServers = [
  {
    name: "whale-memory",
    enable: true,
    host: "127.0.0.1",
    port: 3001,
    messagePostFormat: "array",
    reportSelfMessage: false,
    token: "whale-2026",
    debug: false,
    heartInterval: 30000,
  },
];

writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
console.log("已写入 WebSocket 服务器配置：");
console.log(JSON.stringify(cfg.network.websocketServers, null, 2));
console.log(`备份：${path}.bak`);
