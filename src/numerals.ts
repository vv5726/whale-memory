/**
 * 把中文数字和阿拉伯数字统一成阿拉伯数字，用于「回答里有没有编造的数字」这类比对。
 *
 * 为什么需要：记忆里写的是「1万次」，模型答「一万次」——人看着一样，
 * 字符串比对却完全不相等，于是正确答案被当成编造拦下来。
 */

const DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 两: 2, 贰: 2, 三: 3, 叁: 3,
  四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7, 八: 8, 捌: 8,
  九: 9, 玖: 9,
};

const UNIT: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };
const BIG: Record<string, number> = { 万: 10_000, 亿: 100_000_000 };

/** 解析一小段中文数字，失败返回 null */
function parseChinese(s: string): number | null {
  if (s.length === 0) return null;
  let total = 0;
  let section = 0;
  let current = 0;
  let sawAny = false;

  for (const ch of s) {
    if (ch in DIGIT) {
      current = DIGIT[ch]!;
      sawAny = true;
    } else if (ch in UNIT) {
      const u = UNIT[ch]!;
      section += (current === 0 ? 1 : current) * u;
      current = 0;
      sawAny = true;
    } else if (ch in BIG) {
      const b = BIG[ch]!;
      section += current;
      total += (section === 0 ? 1 : section) * b;
      section = 0;
      current = 0;
      sawAny = true;
    } else {
      return null;
    }
  }
  if (!sawAny) return null;
  return total + section + current;
}

/**
 * 提取一段文字里的所有数字（统一成阿拉伯），返回集合。
 * 同时收「1万」这种阿拉伯+单位的组合。
 */
export function normalizeNumbers(text: string): Set<string> {
  const out = new Set<string>();

  // 阿拉伯数字（可带小数）+ 可选中文单位
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(万|亿|千|百)?/g)) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    const unit = m[2];
    const scaled = unit === "万" ? n * 10_000 : unit === "亿" ? n * 100_000_000 : unit === "千" ? n * 1000 : unit === "百" ? n * 100 : n;
    out.add(String(Math.round(n)));
    if (scaled !== n) out.add(String(Math.round(scaled)));
  }

  // 中文数字串（连续的中文数字/单位）
  for (const m of text.matchAll(/[零〇一壹二两贰三叁四肆五伍六陆七柒八捌九玖十拾百佰千仟万]{1,}/g)) {
    const raw = m[0];
    const parsed = parseChinese(raw);
    if (parsed !== null) {
      out.add(String(parsed));
      // 「一万」也可能被当成 1 和 10000 两种写法引用
      if (raw.length > 1) {
        const head = parseChinese(raw[0]!);
        if (head !== null) out.add(String(head));
      }
    }
  }

  return out;
}

/** 回答里出现的数字，是否都能在「允许的来源」里找到 */
export function numbersBackedBy(reply: string, allowed: string): boolean {
  const have = normalizeNumbers(allowed);
  for (const n of normalizeNumbers(reply)) {
    if (have.has(n)) continue;
    // 单字符数字太容易碰运气（比如「一」「三」），不作为拦截依据
    if (n.length === 1) continue;
    return false;
  }
  return true;
}
