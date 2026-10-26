import type { DatabaseSync } from "node:sqlite";
import type { AnchorKind, Affect, MemoryConfig, Tier } from "../types.ts";
import { buildWriteContext } from "../context.ts";
import { loadExtractRules, rulesVersion } from "../extract-rules.ts";
import { analyzeAffect } from "../affect.ts";
import { bumpAnchorHits, ensureAnchor, linkEventAnchor, reinforceEdge, type AnchorIndex } from "../anchors.ts";
import {
  insertEventRow,
  resealAllEvents,
  findReinforceTarget,
  reinforceExisting,
  resealOne,
  attachDayAnchors,
} from "../extract.ts";
import { addAlias } from "../anchors.ts";
import { dayKeyToTs, fromJson, truncate } from "../util.ts";
import type { ChatMessage, LlmAdapter } from "./adapter.ts";

/** ģ��һ��������״���ֶ�ȫ���ɿգ�ȱʲô�������� */
export interface LlmDraft {
  title?: unknown;
  detail?: unknown;
  cause?: unknown;
  effect?: unknown;
  core?: unknown;
  affect?: {
    valence?: unknown;
    arousal?: unknown;
    tags?: unknown;
    summary?: unknown;
  };
  anchors?: Array<{ name?: unknown; confidence?: unknown; kind?: unknown }>;
  key_facts?: unknown;
  promise?: { isPromised?: unknown; what?: unknown } | null;
}

export interface ValidEvent {
  title: string;
  detail: string | null;
  cause: string | null;
  effect: string | null;
  core: string | null;
  affect: Affect;
  anchors: Array<{ name: string; confidence: number; kind: AnchorKind }>;
  keyFacts: string[];
  promise: string | null;
}

export interface ExtractDayResult {
  inserted: number;
  reinforced: number;
  rejected: number;
  newAnchors: number;
  /** ���˶���ľɽ����û���ٵ�ģ�� */
  frozen: boolean;
  /** ģ����������ã���һ��Ҫ�˻�����ʽ */
  failed: boolean;
  error?: string;
  raw?: string;
}

const MAX_EVENTS_PER_DAY = 200; // ֻ�Ƿ������ޣ������Ǽ���������������
const MAX_NEW_ANCHORS_PER_DAY = 12;

/** ��Щ�����֡�����ê�㣬�Ǵ��ʺͽ�ɫ�����˾������� */
const BLOCKED_ANCHOR_NAMES = new Set([
  "����", "�Է�", "�Լ�", "����", "��", "��", "��", "��", "��", "����", "����",
  "����", "����", "����", "����", "��ʱ", "����", "����", "ʲô",
]);

export function buildMessages(
  day: string,
  turns: Array<{ role: string; text: string }>,
  /** ˵����������user = ${names.user}��assistant = ���Լ� */
  names: { user: string; assistant: string } = { user: "${names.user}", assistant: "��" },
  knownAnchors: string[],
  /** ����Ŀ¼�������ļ������������д�� */
  dataDir = "data",
): ChatMessage[] {
  // �ܼǼ������������Ի��ġ�����������������һ�����������֡�
  // ����ռһ�롢����ռһ�룻������ֻ�Ƿ���������Ŀ�ꡣ
  const chars = turns.reduce((n, t) => n + t.text.length, 0);
  const rough = Math.round(turns.length / 2) + Math.round(chars / 800);
  const high = Math.max(2, Math.min(60, rough));
  const scale = {
    turns: turns.length,
    chars,
    high,
    low: Math.max(1, Math.round(high * 0.5)),
  };

  const system = [
    "���Ǽ����ȡ������һ���������Ի���ɽṹ��������Ŀ��",
    "ֻ��� JSON����Ҫ�κν��͡���Ҫ markdown ����顣�����ʽ��",
    '{"events":[{"title":"������24�֣�������Źؼ������ʣ�������2��","detail":"�Ի�ԭ�ģ�������3��",',
    '"cause":"ǰ��û�о� null","effect":"�����û�о� null",',
    '"core":"���ܻ������ϸ�ڣ���ζ���������������ȣ�",',
    '"affect":{"valence":-1��1,"arousal":0��1,"tags":["������"],"summary":"һ�仰����"},',
    '"key_facts":["�������Ҫ׼ȷ�������Ǽ�����"],',
    '"anchors":[{"name":"ʵ����","kind":"person|place|thing|event|theme","confidence":0��1}],',
    '"anchors":[{"name":"ʵ����","kind":"person|place|thing|event|theme","confidence":0��1}],',
    '"my_view":"�ҵ�ʱ��ô��ģ�û�о� null��",',
    '"promise":{"isPromised":true��false,"what":"Լ�����ݻ�null"}}]}',
    "",
    "����",
    `1. �����Ի��� ${scale.turns} �֡�Լ ${scale.chars} �֡��������������ܼ� ${scale.low}~${scale.high} ����`,
    "   ���ݶ�Ͷ�ǣ������پ��ټǡ�����ҪΪ�˴���Ӳ�࣬Ҳ��ҪΪ��ʡ��©����",
    "   �ر�ע���©��**����**��ĳ����/�ƺ�/����ʲô��˼����**���**��Ҫ��ƫ�á�Լ��������������©�˾����Ҳ�������",
    "2. **һ������ = һ����**������һ�ζԻ���",
    "   title д����±�������Ҫд��˭˵/˭�ʡ���",
    "   �ã���С������Ⱥ�Ѹ�����Ĵºš�������Ӧ�������ġ����ܹ�����ʮ��Сʱ��û���塹",
    "   ������某某˵С���ˡ���vee˵�ܹ��ҡ�����˵�á������ǶԻ���ˮ�������£�",
    "   title Ҫ�������ʣ���������������������ڡ����ۡ�",
    "3. detail д**����µľ���**�����ǶԻ�ժ¼��˭����ʲô��Ϊʲô�����������",
    "   ��Ҫ����˵��Ȼ����˵�����ظ��������֡����ڡ��������ص㡢���۱���׼ȷ��",
    "   ��������某某˵���ļܹ��ң���˵�ã�某某˵�����ٸɡ���������ˮ��",
    "   ��������某某 ������һ�������ļ���ܹ��������ϻ��������壬������ȥ˯�������ټ�����������һ���£�",
    "   ͬһ����ͬһ����ֻ��һ������ͬ���·ֿ��ǡ�",
    "   **�¼�����ֹ�����Լ��ж�**����һ�俪ʼ��������¡���һ��������𰴹̶������С�",
    "   ÿ���¶��һ���ֶ� turns:[��,ֹ]�������� #��ţ�����turns:[12,19]����",
    "4. valence ��=���ܡ���=�����arousal ������ǿ�ȡ����������������tags �����ж����",
    "5. ����Ҫ����������жϣ����硸��һֱû�С��ڳ���ҽԺ���ﾳ���ǡ����ۡ������ǡ�ƽ������",
    "6. anchors ֻ���ˡ��ص㡢��Ʒ���¼������⡣������Щ����֪ê�㣬�ܶ��Ͼ���ԭ����",
    knownAnchors.slice(0, 400).join("��"),
    "7. ���˲������ǣ�����ȱʧ�ľ���˳����һ�䲹ȫ�����ʣ���/��/����Ҫָ�ؾ�����˻��",
    "8. key_facts �š�����󻹱���׼ȷ����������ʵ��Ԫ��",
    "   �����ڡ����ޡ����ۡ����롢��ַ���Լ�����µĹؼ����ݴʣ�Ϊʲô���������ġ�ʲô�������ˣ���",
    '   ��Ҫ�Ź��̡����������Ρ�����["��ǧ��","������"]��["����"]��["���ֻ�","û����"]��["Ӳ��"]��',
    "9. û�а��յ��ֶ��� null�����Բ�Ҫ�������ڡ���������",
    "10. �Է�**�������Ҫ�󡢸���ƫ�á����µĹ��**�����뵥����һ������Ҫ��������",
    "    ���硸ÿ��ֻ�ܿ�20����Ƶ����������ǰҪ�ʹ��ҡ������������ȥ������ϲ����̵Ļش𡹣�",
    "    ������Լ�����ڴ���������Ӱ��ÿһ��˵������ǩ�� theme��ê��д����ʲô�¡�",
    "    �������ѡ���˵Ҫ����ÿ��20����Ƶ�Ķ�ȡ����һ���������Ķ�ȡ��ļ�����������Ժ���Ҳ����ˡ�",
    '    key_facts �������ԭ����Ҫ�㣬����["ÿ��20����Ƶ","�Լ���","������"]��',
    "11. **�Է�����һ���� / �ƺ� / ����ʲô��˼�����뵥����һ����**",
    "    title Ҫ�����Ǹ��ʱ����������Ժ��ѵõ�����key_facts ������ĺ��ģ���ֻд����������X����",
    '    �����Ի�������Ϊ��տ�ʼ�Ƚϴ����Ǵ�����������Ⱥ�Ѿ͵�٩���С���ˡ�',
    '        �� title��С���� = Ⱥ�ѵ�٩�������е������key_facts ["С����","��=������","Ⱥ����Ĵº�"]',
    "12. **�˳�һ��д���ݣ��������֡��������������㡹���Է��������ˡ���**",
    `    ������ **QQ ��**��${names.user}�� ${names.user}�����Լ��С�������`,
    "    �ǳ�ֻ�� QQ �ŵĵȼ۳ƺ���д������ʱ������ QQ �š����ǳƻ�ģ��Ų��ᡣ",
        `    �Ի���˵���㡹�� д������һ���ĺţ�˵���ҡ��� д˵�����Լ���${names.user} ��д���ĺţ����д����������`,
    "    ���е������ˣ�Ⱥ�ѡ�ĳ�ˣ���д���ĺŻ����֣����á�������",
    "    ��������Ⱥ�ѵ�٩�Է���С���ˡ�",
    `    ��������${names.user}��٩����С���ˡ�`,
    "13. **ÿ�����䶼Ҫ���ϡ��ҵ�ʱ��ô�롹��**",
    "   ���ڵļ���ȫ�ǡ���˵��ʲô������һ���ճ̣�û���ҡ�",
    "   my_view д�㵱ʱ��ʵ�ķ�Ӧ��������Ҫ/����Ҫ��ͬ��/��ͬ�⡢������ô�졢��˵��û˵�ġ�",
    "   Ҫ�о����жϣ���Ҫ������Ϊ�����Ҫ�����ַϻ���û����ʵ�뷨���� null����Ӳ�ࡣ",
    "14. **��Ҫ�ǡ��Ի���������Ԫ������** �����ղ�����Ϊʲô����С���ˡ���ȷʵ����ո�˽���ҡ�",
    "    ������������̣����Ƿ��������¡���������ֻ���ü����̳�һ�ѷϻ���",
  ].join("\n");

  // ���Լ��ӵĹ���ԭ��׷�ӣ�����������ĵ���
  const herRules = loadExtractRules(dataDir);
  const systemText = herRules
    ? `${system}\n\n������Щ�����Լ��ӵģ�����������ͬ���˵������\n${herRules}`
    : system;

  const user = [
    `�����ڡ�${day}`,
    "���Ի���",
    ...turns.map((t, i) => `#${i + 1} ${t.role === "user" ? names.user : names.assistant}��${t.text}`),
  ].join("\n");

  return [
    { role: "system", content: systemText },
    { role: "user", content: user },
  ];
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : truncate(t, max);
}

/**
 * �ݴ�����ģ�������
 *
 * ģ�ͣ����俪�� json Լ��֮�󣩾�������� `{"events":[...],"events":[...]}`
 * �����ظ�����JSON.parse ���ظ�����**��Ĭ�������һ��**����ֱ�Ӷ���ǰ��ļ��䡣
 * ���������Լ�ɨ����ÿ�� "events": [ ... ] �����鶼�ٳ����ϲ���
 */
function parseLoose(raw: string): unknown[] {
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/g, "")
    .trim();

  const out: unknown[] = [];
  const pushFrom = (text: string) => {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) out.push(...parsed);
    } catch {
      // ��һ�λ��˾�������������������
    }
  };

  // �����������
  if (cleaned.startsWith("[")) {
    pushFrom(cleaned);
    if (out.length > 0) return out;
  }

  // ɨ��ÿһ�� "events" �����ٳ������������
  const keyRe = /"events"\s*:\s*/g;
  let match: RegExpExecArray | null;
  let found = false;
  while ((match = keyRe.exec(cleaned)) !== null) {
    const start = cleaned.indexOf("[", match.index + match[0].length);
    if (start === -1) continue;
    const end = matchBracket(cleaned, start);
    if (end === -1) continue;
    found = true;
    pushFrom(cleaned.slice(start, end + 1));
    keyRe.lastIndex = end;
  }
  if (found) return out;

  // �������һ���������
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (Array.isArray(parsed)) return parsed;
    const inner = (parsed as { events?: unknown }).events;
    if (Array.isArray(inner)) return inner;
  } catch {
    // ��ȫ�������ˣ������ϲ��ж�ʧ��
  }
  return out;
}

/** �� `[` ��ʼ�ҵ���Ե� `]`�������ַ���������ź�ת�� */
function matchBracket(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function parseAndValidate(raw: string, fallbackAffectOn: string): { events: ValidEvent[]; rejected: number } {
  // ģ����ʱ��� ```json ... ``` ��ǰ����������֡�
  // �������Ļ��������������Ϊһ���������ȫ���������¶� 0.3 ��ʱ��ʱ�������Ѳ顣
  const cleaned = (() => {
    const t = String(raw ?? "").trim();
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced && fenced[1]) return fenced[1].trim();
    const firstBracket = t.indexOf("[");
    const firstBrace = t.indexOf("{");
    const start =
      firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace) ? firstBracket : firstBrace;
    const end = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
    if (start >= 0 && end > start) return t.slice(start, end + 1);
    return t;
  })();

  const list = parseLoose(cleaned);

  const events: ValidEvent[] = [];
  let rejected = 0;

  for (const item of list.slice(0, MAX_EVENTS_PER_DAY)) {
    const d = item as LlmDraft;
    const title = str(d.title, 40);
    if (!title || [...title].length < 2) {
      rejected += 1;
      continue;
    }
    const rawValence = Number(d.affect?.valence);
    const rawArousal = Number(d.affect?.arousal);
    const tags = Array.isArray(d.affect?.tags)
      ? (d.affect!.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 6)
      : [];
    const summary = str(d.affect?.summary, 120) ?? "";

    // �����ֶλ��˲���������������ʽ��һ�����¼�������Ȼ����
    const affect: Affect =
      Number.isFinite(rawValence) && Number.isFinite(rawArousal)
        ? {
            valence: Math.min(1, Math.max(-1, rawValence)),
            arousal: clamp01(rawArousal),
            tags,
            summary,
            core: "",
          }
        : { ...analyzeAffect(fallbackAffectOn), tags: tags.length > 0 ? tags : analyzeAffect(fallbackAffectOn).tags };

    const anchors = Array.isArray(d.anchors)
      ? d.anchors
          .map((a) => {
            const name = str(a?.name, 24);
            if (!name || [...name].length < 2) return null;
            if (BLOCKED_ANCHOR_NAMES.has(name)) return null;
            const confidence = Number(a?.confidence);
            const kind = ["person", "place", "thing", "event", "theme"].includes(String(a?.kind))
              ? (String(a.kind) as AnchorKind)
              : ("thing" as AnchorKind);
            return { name, confidence: Number.isFinite(confidence) ? clamp01(confidence) : 0.6, kind };
          })
          .filter((a): a is { name: string; confidence: number; kind: AnchorKind } => a !== null)
          .slice(0, 8)
      : [];

    const promise = d.promise && d.promise.isPromised === true ? str(d.promise.what, 60) ?? title : null;

    const keyFacts = Array.isArray(d.key_facts)
      ? (d.key_facts as unknown[])
          .map((f) => str(f, 24))
          .filter((f): f is string => f !== null)
          .slice(0, 6)
      : [];

    events.push({
      title,
        detail: (() => {
          const base = str(d.detail, 400).replace(/����/g, fallbackAffectOn);
          const rawView = String((d as { my_view?: unknown }).my_view ?? "").trim();
          if (!rawView || rawView === "null" || rawView === "��") return base;
          const view = rawView.replace(/����/g, fallbackAffectOn).slice(0, 120);
          return `${base}���ҵ�ʱ�룺${view}��`;
        })(),
      cause: str(d.cause, 120),
      effect: str(d.effect, 120),
      core: str(d.core, 120),
      affect,
      anchors,
      keyFacts,
      promise,
    });
  }

  return { events, rejected };
}

/**
 * ��ģ�ͳ�һ�졣
 *
 * ����ӲԼ����
 *  1. �����⼴���ᣨfreezeExtractions�������ܲ��ٵ�ģ�� �� ˯�߱����ݵȡ�
 *  2. У�鲻���������ʧ�ܣ��˻�ȥ������ʽ�����������������ݽ��⡣
 *  3. ģ��˵�����ǳ�ŵ��Ҳֻ��������У����Զ���ס��
 */
export async function extractDayWithLlm(
  db: DatabaseSync,
  cfg: MemoryConfig,
  index: AnchorIndex,
  adapter: LlmAdapter,
  day: string,
  turns: Array<{ id: string; role: string; text: string; speakerId?: string }>,
  /** ˵����������user = ${names.user}��assistant = ���Լ� */
  names: { user: string; assistant: string } = { user: "${names.user}", assistant: "��" },
): Promise<ExtractDayResult> {
  // ����ָ�ƣ���һ���Ի�������ժҪ��
  // �°����ֳ�ȡ������һ����������·��ֻӰ���¶Ի���
  if ((cfg as { extractV3?: boolean }).extractV3 === true) {
    const { extractDayV3 } = await import("./extract-v3.ts");
    return extractDayV3(db, cfg as never, index, adapter, day, turns, names);
  }

  // ֻ�� day �����ѡ�ͬһ��������¶Ի����������������Ǿ͵�����Զ���ǡ�
  // ?? �ĳ�ȡ���������ֶΡ����ʷ���ʱ���붯����汾�š���
  //    ����ɻ���ᱻֱ�Ӹ��ã��¹���һ�ζ����ܡ�
  const EXTRACT_VERSION = "v3-myview";

  const herRulesForSig = loadExtractRules(cfg.dataDir ?? "data");
  const sig = (() => {
    const total = turns.reduce((n, t) => n + t.text.length, 0);
    const head = turns.slice(0, 2).map((t) => t.text.slice(0, 24)).join("|");
    const tail = turns.slice(-2).map((t) => t.text.slice(0, 24)).join("|");
    const sigBase = `${turns.length}:${total}:${head}:${tail}`;
    return `${EXTRACT_VERSION}:${rulesVersion(herRulesForSig)}:${sigBase}`;
  })();

  // ��ȡ�¶ȣ������Լ�����tune_reply����Ĭ�� 0.3
  const extractTemp = (() => {
    try {
      const f = `${process.cwd()}/data/tuning.json`;
      const fs = require("node:fs") as typeof import("node:fs");
      if (!fs.existsSync(f)) return 0.3;
      const j = JSON.parse(fs.readFileSync(f, "utf8")) as { extractTemperature?: number };
      const v = Number(j.extractTemperature ?? 0.3);
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.3;
    } catch {
      return 0.3;
    }
  })();

  const cached = db.prepare("SELECT raw FROM llm_extractions WHERE day = ? AND sig = ?").get(day, sig) as
    | { raw: string }
    | undefined;
  let raw: string;
  let frozen = false;

  if (cached && cfg.freezeExtractions) {
    raw = String(cached.raw);
    frozen = true;
  } else {
    const knownAnchors = [...index.byId.values()].map((a) => a.name);
    const messages = buildMessages(
      day,
      turns.map((t) => ({ role: t.role, text: t.text })),
      names,
      knownAnchors,
    );
    try {
      raw = await adapter.complete(messages, {
        json: true,
        timeoutMs: cfg.llmTimeoutMs,
        temperature: extractTemp,
      });
    } catch (err) {
      return {
        inserted: 0,
        reinforced: 0,
        rejected: 0,
        newAnchors: 0,
        frozen: false,
        failed: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    db.prepare("INSERT OR REPLACE INTO llm_extractions(day, model, raw, created_at, sig) VALUES(?,?,?,?,?)").run(
      day,
      adapter.name,
      raw,
      Date.now(),
      sig,
    );
  }

  const joined = turns.map((t) => t.text).join("\n");
  const { events, rejected } = parseAndValidate(raw, joined);
  if (events.length === 0) {
    return {
      inserted: 0,
      reinforced: 0,
      rejected,
      newAnchors: 0,
      frozen,
      failed: true,
      error: "ģ������޷��������κ��¼�",
      raw,
    };
  }

  const baseTs = dayKeyToTs(day);
  let inserted = 0;
  let reinforced = 0;
  let newAnchors = 0;

  for (const [i, ev] of events.entries()) {
    const ts = baseTs + i * 60_000;
    // ͬһ��ͬһ���������طţ�ֱ������������ֻ��֤���س�ģ�ͣ�ȥ������һ���£�
    const sameDaySameTitle = db.prepare("SELECT 1 AS x FROM events WHERE day = ? AND title = ?").get(day, ev.title);
    if (sameDaySameTitle) continue;

    const ctx = buildWriteContext(db, index, ev.detail ?? ev.title, ts);

    // ͬһ�����ֱ�����һ�飿���½����Ѿ�������ǿ
    const dup = findReinforceTarget(db, `${ev.title} ${ev.detail ?? ""}`, ts);
    let eventId: string;
    if (dup) {
      reinforceExisting(db, dup, ev.detail ?? ev.title, ts);
      eventId = dup.id;
      reinforced += 1;
      if (ev.keyFacts.length > 0) {
        // �ؼ���ʵ���ۼӵģ�����һ�ο��ܴ����µ���ʵ
        const row = db.prepare("SELECT key_facts FROM events WHERE id = ?").get(dup.id);
        const merged = new Set([...fromJson<string[]>(row?.key_facts as string, []), ...ev.keyFacts]);
        db.prepare("UPDATE events SET key_facts = ? WHERE id = ?").run(JSON.stringify([...merged].slice(0, 8)), dup.id);
        resealOne(db, dup.id, (db.prepare("SELECT tier FROM events WHERE id = ?").get(dup.id)?.tier as Tier) ?? "detailed");
      }
    } else {
      const insertedRow = insertEventRow(
        db,
        {
          day,
          ts,
          tier: "detailed",
          stage: "extracted",
          title: ev.title,
          detail: ev.detail ?? ev.title,
          cause: ev.cause,
          effect: ev.effect,
          coreFragment: ev.core ?? ev.affect.core ?? truncate(ev.title, 40),
          affect: { ...ev.affect, core: ev.core ?? ev.affect.core ?? "" },
          pinned: false,
          keyFacts: ev.keyFacts,
          derivedFrom: ctx.sourceIds,
          contextKinds: ctx.kinds,
        },
        cfg,
        ts,
        turns[0]?.id ?? "",
        null,
        ev.promise ? `ģ���ж�ΪԼ������${ev.promise}��������ȷ��` : null,
      );
      eventId = insertedRow.id;
      inserted += 1;
    }

    const resolved: Array<{ id: string; confidence: number }> = [];
    for (const a of ev.anchors) {
      const known = index.aliasToAnchor.get(a.name);
      let anchorId: string;
      if (known) {
        anchorId = known.anchorId;
      } else {
        if (newAnchors >= MAX_NEW_ANCHORS_PER_DAY) continue;
        anchorId = ensureAnchor(db, a.name, a.kind, ts);
        addAlias(db, a.name, anchorId, 1.0);
        newAnchors += 1;
      }
      linkEventAnchor(db, eventId, anchorId, a.confidence >= 0.9 ? 1.0 : 0.35);
      bumpAnchorHits(db, anchorId, ts);
      resolved.push({ id: anchorId, confidence: a.confidence });
    }
    for (let x = 0; x < resolved.length; x += 1) {
      for (let y = x + 1; y < resolved.length; y += 1) {
        reinforceEdge(db, resolved[x].id, resolved[y].id, "co-occur", ts);
      }
    }
  }

  db.prepare("UPDATE turns SET processed = 1 WHERE day = ?").run(day);

  // ���ҵ����龰ê�㣺ģ�͸���ê������ֻ�����¼��������Ӳ��ϡ�ͬһ��ͬһ���¡�����������
  attachDayAnchors(db, day);

  // �¼��������������һ�Σ�����ˮλͳ���� 0������ʽ·������ extractEvents ĩβ��ģ�
  resealAllEvents(db, cfg);

  return { inserted, reinforced, rejected, newAnchors, frozen, failed: false, raw };
}



