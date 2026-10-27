import { readFileSync, writeFileSync } from "node:fs";

// ── ① db：加 kind 列 ──
{
  const p = "src/db.ts";
  let s = readFileSync(p, "utf8");
  if (!s.includes('"kind"')) {
    const anchor = '  ensureColumn(db, "event_anchors", "role", "TEXT NOT NULL DEFAULT \'mentioned\'");';
    s = s.replace(
      anchor,
      [
        anchor,
        "  // 记忆分四类（借 sage-mem 的分法）：",
        "  //   user 你是谁 / feedback 该怎么做事 / project 项目状态 / reference 外部指针 / event 发生过的事",
        '  ensureColumn(db, "events", "kind", "TEXT NOT NULL DEFAULT \'event\'");',
      ].join("\n"),
    );
    writeFileSync(p, s, "utf8");
    console.log("db：kind 列已加");
  }
}

// ── ② 分类器：规则判断，不花模型钱 ──
{
  const p = "src/classify.ts";
  let s = readFileSync(p, "utf8").length > 0 ? "" : "";
  void s;
  const body = `/**
 * 给一条记忆分类。
 *
 * 四类借自 sage-mem：user / feedback / project / reference，其余是 event。
 * 用规则而不是模型——分类很便宜，没必要每写完一条再调一次。
 *
 * 关键在 feedback：**对方定的规矩、偏好、要求**。
 * 这类东西不能靠检索——今天想不起来「他说过要进修」，就真的不会去进修。
 */
export type MemoryKind = "user" | "feedback" | "project" | "reference" | "event";

const FEEDBACK = /(要求|规矩|以后|不许|不要再|别再|必须|记得要|应该|最好|下次|每次|习惯|偏好|喜欢.*说|别这么|收着点|进修|学习|练)/;
const USER = /(我是谁|叫什么|名字|昵称|岁数|生日|住在|工作|职业|性格|脾气|喜欢什么|不喜欢)/;
const PROJECT = /(项目|在做|进度|计划|下一步|正在写|开发|部署|上线|仓库|代码)/;
const REFERENCE = /(https?:\\/\\/|文档|链接|地址|仓库在|参考|资料)/;

export function classify(text: string): MemoryKind {
  const t = String(text ?? "");
  if (REFERENCE.test(t)) return "reference";
  if (FEEDBACK.test(t)) return "feedback";
  if (USER.test(t)) return "user";
  if (PROJECT.test(t)) return "project";
  return "event";
}
`;
  writeFileSync(p, body, "utf8");
  console.log("classify.ts 已写");
}
