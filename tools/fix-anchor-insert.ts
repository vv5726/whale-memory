import { readFileSync, writeFileSync } from "node:fs";

const p = "src/scene-anchor.ts";
let s = readFileSync(p, "utf8");
const before = s;

// anchors 表有 NOT NULL 的 salience / first_seen，插入必须带全，否则被 catch 吞掉
s = s.replace(
  'db.prepare("INSERT INTO anchors(id, name, kind, hits, last_seen) VALUES(?,?,?,?,?)").run(\n      id,\n      name,\n      "event",\n      1,\n      Date.now(),\n    );',
  'db.prepare(\n      "INSERT INTO anchors(id, name, kind, salience, hits, first_seen, last_seen) VALUES(?,?,?,?,?,?,?)",\n    ).run(id, name, "event", 1.0, 1, Date.now(), Date.now());',
);
s = s.replace(
  'db.prepare("INSERT INTO anchors(id, name, kind, hits, last_seen) VALUES(?,?,?,?,?)").run(\n      id,\n      name,\n      "scene",\n      1,\n      Date.now(),\n    );',
  'db.prepare(\n      "INSERT INTO anchors(id, name, kind, salience, hits, first_seen, last_seen) VALUES(?,?,?,?,?,?,?)",\n    ).run(id, name, "scene", 1.0, 1, Date.now(), Date.now());',
);

if (s === before) {
  for (const l of s.split("\n").filter((x) => x.includes("INSERT INTO anchors"))) console.log("实际：" + l.trim());
  writeFileSync(p, s, "utf8");
} else {
  writeFileSync(p, s, "utf8");
  console.log("锚点插入已补全 NOT NULL 字段");
}
