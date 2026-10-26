import type { DatabaseSync } from "node:sqlite";
import { listPeople } from "./people.ts";

/**
 * 「这个词是谁说的」必须落到一个具体的人。
 *
 * 为什么单独一个文件：service.ts 今天被反复改坏过，里面的行已经不稳。
 * 新逻辑放这里，service 里只留一行调用，改一行不容易出事。
 *
 * 拒绝「群友」「某人」「大家」这类——它们不是锚点，收进来只会让词库又变成垃圾桶。
 */
const NOT_A_PERSON = /^(群友|群里的|大家|某人|有人|别人|他们|她们|朋友|网友|qq群|群里|\s*)$/i;

export function resolveSaidBy(db: DatabaseSync, saidBy: unknown): { qq: string; name: string } | null {
  const who = String(saidBy ?? "").trim();
  if (who.length === 0) return null;
  if (NOT_A_PERSON.test(who)) return null;

  const people = listPeople(db);
  const hit = people.find(
    (p) => p.qqId === who || p.name === who || (p.aliases ?? []).includes(who),
  );
  if (hit) return { qq: hit.qqId, name: hit.name || hit.qqId };

  // 名字里带这个人（「vv 说的」这种）也算
  const partial = people.find((p) => p.name && p.name.length >= 2 && who.includes(p.name));
  if (partial) return { qq: partial.qqId, name: partial.name || partial.qqId };

  return null;
}
