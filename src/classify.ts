/**
 * 给一条记忆分类。
 *
 * 四类借自 sage-mem：user / feedback / project / reference，其余是 event。
 * 用规则而不是模型——分类很便宜，没必要每写完一条再调一次。
 *
 * 关键在 feedback：**对方定的规矩、偏好、要求**。
 * 这类东西不能靠检索——今天想不起来「他说过要进修」，就真的不会去进修。
 */
export type MemoryKind = "user" | "feedback" | "project" | "reference" | "event";

const REFERENCE = /(https?:\/\/|文档|链接|地址|仓库在|参考资料)/;
const FEEDBACK =
  /(要求|规矩|以后|不许|不要再|别再|必须|记得要|应该|下次|每次|偏好|别这么|收着点|进修|练习|学会|记住这)/;
const USER = /(你是谁|叫什么|名字|昵称|生日|住在|工作|职业|性格|脾气|喜欢什么|不喜欢)/;
const PROJECT = /(项目|在做|进度|计划|下一步|正在写|开发|部署|上线|仓库|代码)/;

export function classify(text: string): MemoryKind {
  const t = String(text ?? "");
  if (REFERENCE.test(t)) return "reference";
  if (FEEDBACK.test(t)) return "feedback";
  if (USER.test(t)) return "user";
  if (PROJECT.test(t)) return "project";
  return "event";
}
