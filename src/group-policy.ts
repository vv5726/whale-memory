import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 每个群的规矩，由她自己定。
 *
 * 为什么不是全局一个开关：
 *   有的群人多、刷得快，见谁都接会烦；有的群就两三个人，不接就没声音。
 *   只有她待在那个群里，才知道该多安静。
 */
export type GroupMode = "all" | "mention";

export interface GroupPolicy {
  /** all = 每条都接；mention = 只被 @ 或叫名字才接 */
  mode?: GroupMode;
  /** 她对这个群的观察：为什么这么设 */
  note?: string;
  updatedAt?: number;
}

type PolicyFile = Record<string, GroupPolicy>;

function fileOf(dataDir: string): string {
  return join(dataDir, "group-policy.json");
}

export function loadPolicies(dataDir: string): PolicyFile {
  try {
    const f = fileOf(dataDir);
    if (!existsSync(f)) return {};
    return JSON.parse(readFileSync(f, "utf8")) as PolicyFile;
  } catch {
    return {};
  }
}

export function savePolicies(dataDir: string, p: PolicyFile): void {
  writeFileSync(fileOf(dataDir), JSON.stringify(p, null, 2), "utf8");
}

/** 这个群该按哪种模式说话（没设就按全局配置） */
export function modeFor(dataDir: string, groupId: number, fallback: GroupMode): GroupMode {
  const p = loadPolicies(dataDir)[String(groupId)];
  return p?.mode ?? fallback;
}

export function setPolicy(dataDir: string, groupId: number, patch: GroupPolicy): GroupPolicy {
  const all = loadPolicies(dataDir);
  const key = String(groupId);
  const next: GroupPolicy = { ...(all[key] ?? {}), ...patch, updatedAt: Date.now() };
  if (patch.mode !== "all" && patch.mode !== "mention") delete next.mode;
  all[key] = next;
  savePolicies(dataDir, all);
  return next;
}
