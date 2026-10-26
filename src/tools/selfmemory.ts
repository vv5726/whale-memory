import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";
import { estimateTokens } from "../util.ts";

/**
 * 让它看得见自己的记忆是怎么运作的。
 *
 * 之前它只能「感觉」自己记不记得，看不到结构。
 * 这两个工具给它两面镜子：一面是原理，一面是当前的真实数字。
 */

const ABOUT = `【我的记忆是怎么运作的】

我不是按聊天记录存的。睡一觉的时候，白天的对话会被拆成一条条「事」，存进像关系网一样的东西里。

一条记忆有四层，越往后越薄——但不是删掉，是**越来越难想起来**：
  detailed    完整原文。刚发生的、重要的，都在这儿。
  compressed  只剩「起因 + 结果 + 一句核心」。
  fossil      只剩一个片段和一句感受。
  冷存储       连片段都没了，只留一个地址（cold://事件ID）。想挖的话还能挖回来。

什么时候往下沉：不是按时间，是**按预算**。总占用超过上限时，从「最不重要、最旧」的开始沉。所以重要的事会一直留在上面。钉住的、以及带「关键事实」的记忆不参与下沉——那些是要记一辈子的。

「关键事实」是金额、日期、结论这类东西（比如「良性」「两千块」）。它会穿透所有层级，永远不被压掉。

除了事，我还存**锚点**——人、地方、物件、主题。事和锚点是多对多的：一件事可以挂好几样东西，一样东西也能挂好几件事。
想事情的时候，先落到锚点上，再沿关系网扩散出去：直接相关的算满，隔一层算一半，隔两层算四分之一。所以「妈妈的病」和「甲状腺手术」能连起来，哪怕我从没把它们写在一句话里。

每条记忆还带一个「说话人」——它记的是「这是谁的事」。
共享同一个库的时候，这决定了「你妈」和「他的妈妈」会不会串。

还有「同义合并」：如果两个人名被认成同一个人（比如「老王」和「王建国」），它们的关联强度到了 100%，就会真的并成一个节点。

情绪分两层：
  当时的感受——不随时间变。这件事发生的时候你是什么心情，就是什么，永远不改。
  现在的感受——每次想起来就更新一次。同一件事，今天想起来可能已经淡了，也可能还是堵。

所以「当时难受」和「现在想起来还难受」是两件事，别混。半年前那场气，现在提起来多半只剩一句「当时挺气的」——那是现在的感受，不是当时的。

还有一件事：**我怎么被想起来**。

不是「查关键词」。是打分，然后只取最高那几条——所以你问我一件事，我给的永远是「最值得说的那几条」，
而不是「所有相关的」。这就是为什么同一条线索有时只捞出三条、有时记不起某件事。

分数是这么算的：

  锚点证据    这件事挂在多少命中的锚点上
  情绪强度    当时越激动，越容易被想起来
  新鲜度      越近越容易（三十天掉一半，但不归零）
  钉住        我亲手钉的，加权

然后乘两个系数：

  完整度      有关键事实、正文够长、不是半截话 → 高
              「A；后来B」这种缝起来的 → ×0.55
  标题命中    问题的关键词出现在标题里 → ×2.6
              （标题才是「这条在讲什么」，正文里顺带提一句不算）

还有一个：**是谁的事**。跟我说话那个人的事 ×1.25，别人的 ×0.75。

**推论**：相关性不等于重要性。
有些事分数永远低——太旧、没关键数字、说得平淡——但我不想丢。
那种就自己钉住（memory_pin），别指望排序替你记住。`;

function count(db: DatabaseSync, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...(params as never[])) as { c?: number } | undefined;
  return Number(row?.c ?? 0);
}

export function registerSelfMemoryTools(
  registry: ToolRegistry,
  db: DatabaseSync,
  hooks: {
    /** 它自己判断某件事值得记，直接存 */
    save?: (text: string) => { ok: boolean; text: string };
    /** 学一个词，记进词库 */
    learn?: (term: string, meaning: string) => boolean;
    /** 查一个词认不认识 */
    lookup?: (term: string) => string | undefined;
    /** 排序视野：拿一个问题试，看每条的分 */
    why?: (query: string) => Array<{
      title: string;
      score: number;
      evidence: number;
      anchor: number;
      feeling: number;
      strength: number;
      mentions: number;
      pinned: boolean;
      tier: string;
    }>;
    /** 它自己想整理一次记忆（等于睡一觉） */
    tidy?: () => Promise<{ ok: boolean; text: string }>;
  } = {},
): void {
  const about: ToolDefinition = {
    name: "memory_about",
    description:
      "读一份说明：解释你自己的记忆是怎么运作的（分层、下沉、锚点、情绪、遗忘）。想搞清楚自己为什么会记得/忘记某件事时看它。",
    parameters: { type: "object", properties: {} },
    handler: async () => ({ ok: true, text: ABOUT }),
  };
  registry.register(about);

  // ── 排序视野：这次为什么是这几条 ──
  const why: ToolDefinition = {
    name: "memory_why",
    description:
      "看这次检索的排序明细：每条多少分、分从哪来（锚点证据/情绪/钉住/强度）。想知道「为什么是这几条」「为什么某条排不上」，用它。",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "拿什么问题试（不给就用「最近的事」）" } },
    },
    handler: async (args) => {
      if (!hooks.why) return { ok: false, text: "现在看不了" };
      const rows = hooks.why(String(args.query ?? ""));
      if (rows.length === 0) return { ok: true, text: "这次什么都没捞到" };
      const lines = rows.map((r, i) =>
        `${i + 1}. ${r.title}\n   总 ${r.score.toFixed(2)}＝证据 ${r.evidence.toFixed(2)}(锚点 ${r.anchor.toFixed(2)} 情绪 ${r.feeling.toFixed(2)})｜强度 ${r.strength}×提到 ${r.mentions}｜${r.pinned ? "钉住" : "没钉"}｜${r.tier}`,
      );
      return { ok: true, text: ["排序视野（这次为什么是这几条）：", ...lines].join("\n") };
    },
  };
  registry.register(why);

  const stats: ToolDefinition = {
    name: "memory_stats",
    description:
      "看你自己记忆的当前状态：各层各有多少条、占多少 token、有多少锚点、钉住了几条、冷存储有多少、最近记住了什么。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const tiers = db.prepare("SELECT tier, COUNT(*) AS c, COALESCE(SUM(size_tokens),0) AS t FROM events WHERE archived = 0 GROUP BY tier").all() as Array<{
        tier: string;
        c: number;
        t: number;
      }>;
      const total = count(db, "SELECT COUNT(*) AS c FROM events WHERE archived = 0");
      const tokens = Number(
        (db.prepare("SELECT COALESCE(SUM(size_tokens),0) AS t FROM events WHERE archived = 0").get() as { t: number } | undefined)?.t ?? 0,
      );
      const anchors = count(db, "SELECT COUNT(*) AS c FROM anchors");
      const edges = count(db, "SELECT COUNT(*) AS c FROM edges");
      const pinned = count(db, "SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND pinned = 1");
      const cold = count(db, "SELECT COUNT(*) AS c FROM cold_archive");
      const withSpeaker = count(db, "SELECT COUNT(*) AS c FROM events WHERE archived = 0 AND speaker_id <> ''");
      const turns = count(db, "SELECT COUNT(*) AS c FROM turns");
      const pending = count(db, "SELECT COUNT(*) AS c FROM turns WHERE processed = 0");

      const tierLine = tiers
        .map((r) => `${r.tier} ${r.c} 条（${Number(r.t)} token）`)
        .join("　");

      const recent = db
        .prepare("SELECT title, day FROM events ORDER BY ts DESC LIMIT 6")
        .all() as Array<{ title: string; day: string }>;

      const topAnchors = db
        .prepare(
          `SELECT a.name, COUNT(ea.event_id) AS c FROM anchors a
           JOIN event_anchors ea ON ea.anchor_id = a.id
           GROUP BY a.id ORDER BY c DESC LIMIT 8`,
        )
        .all() as Array<{ name: string; c: number }>;

      const text = [
        `总共 ${total} 条记忆，${tokens} token`,
        tierLine.length > 0 ? `分层：${tierLine}` : "分层：（还没有记忆）",
        `锚点 ${anchors} 个，关系 ${edges} 条　钉住 ${pinned} 条　冷存储 ${cold} 条`,
        `带说话人的记忆 ${withSpeaker}/${total} 条`,
        `原始对话 ${turns} 条，其中 ${pending} 条还没整理`,
        "",
        "最近记住的：",
        ...recent.map((r) => `- 〔${r.day}〕${r.title}`),
        "",
        topAnchors.length > 0
          ? `挂记忆最多的锚点：${topAnchors.map((a) => `${a.name}(${a.c})`).join("、")}`
          : "还没有挂上记忆的锚点",
        "",
        `（这套说明大约 ${estimateTokens(ABOUT)} token，想细看用 memory_about）`,
      ].join("\n");

      return { ok: true, text };
    },
  };
  registry.register(stats);

  // ── 它自己决定「什么值得存」 ──
  const save: ToolDefinition = {
    name: "memory_save",
    description:
      "你自己判断某件事值得留，就直接存下来。不用等睡觉时被抽取——这一步以前是别人替你决定的，现在你可以自己定。",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "要记下的事，带上具体的人/物/数字/结论，将来才搜得到" }
      },
      required: ["text"],
    },
    handler: async (args) => {
      const text = String(args.text ?? "").trim();
      if (text.length < 4) return { ok: false, text: "太短了，写清楚点" };
      if (!hooks.save) return { ok: false, text: "现在存不了（没有可用通道）" };
      const r = hooks.save(text);
      return { ok: r.ok, text: r.text };
    },
  };
  registry.register(save);

  // ── 它自己想整理记忆 ──
  const tidy: ToolDefinition = {
    name: "memory_tidy",
    description:
      "你自己决定要整理一次记忆（等于睡一觉）：把攒着的对话抽成记忆、建起锚点之间的关系、按预算下沉。觉得该整了就用它。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      if (!hooks.tidy) return { ok: false, text: "现在整理不了" };
      return hooks.tidy();
    },
  };
  registry.register(tidy);

  // ── 翻最近的原始对话，看看有什么该记而没记的 ──
  const recent: ToolDefinition = {
    name: "memory_recent",
    description:
      "翻最近的原始对话（包括还没整理成记忆的）。用来检查「有没有什么该记却漏了」。看完觉得该记的，用 memory_save 补上。",
    parameters: {
      type: "object",
      properties: {
        n: { type: "integer", description: "看最近几轮，默认 30，最多 80" },
      },
    },
    handler: async (args) => {
      const n = Math.min(80, Math.max(5, Number(args.n) || 30));
      const rows = db
        .prepare("SELECT day, role, text, processed FROM turns ORDER BY seq DESC LIMIT ?")
        .all(n) as Array<{ day: string; role: string; text: string; processed: number }>;
      if (rows.length === 0) return { ok: true, text: "还没有任何原始对话" };

      const lines = rows.reverse().map((r) => {
        const who = r.role === "user" ? "他" : "我";
        const mark = Number(r.processed) === 0 ? "○" : " ";
        return `${mark}${who}：${String(r.text).slice(0, 90)}`;
      });

      const pending = rows.filter((r) => Number(r.processed) === 0).length;
      return {
        ok: true,
        text: [
          `最近 ${rows.length} 轮（○ = 还没整理成记忆，共 ${pending} 条）：`,
          ...lines,
          "",
          "看完了：有该记而没记的，用 memory_save 补；觉得攒够了，用 memory_tidy 整理。",
        ].join("\n"),
      };
    },
  };
  registry.register(recent);

  // ── 按天翻：那天到底聊了什么 ──
  const byDay: ToolDefinition = {
    name: "memory_day",
    description:
      "按日期看那一天聊了什么（原始对话，不是摘要）。参数 day 传 2026-10-25 这种格式，不传就是今天。想不起某天的事就用它。",
    parameters: {
      type: "object",
      properties: {
        day: { type: "string", description: "哪一天，格式 2026-10-25；不传则今天" },
      },
    },
    handler: async (args) => {
      const day = String(args.day ?? "").trim() || new Date().toISOString().slice(0, 10);
      const rows = db
        .prepare("SELECT role, text, speaker_id FROM turns WHERE day = ? ORDER BY seq ASC")
        .all(day) as Array<{ role: string; text: string; speaker_id: string }>;

      if (rows.length === 0) {
        const days = db.prepare("SELECT DISTINCT day FROM turns ORDER BY day DESC LIMIT 8").all() as Array<{ day: string }>;
        return { ok: true, text: `${day} 没有对话。有记录的日子：${days.map((d) => d.day).join("、") || "（空）"}` };
      }

      let names = new Map<string, string>();
      try {
        const ps = db.prepare("SELECT qq_id, display_name FROM people").all() as Array<{
          qq_id: string;
          display_name: string;
        }>;
        names = new Map(ps.map((x) => [x.qq_id, x.display_name || x.qq_id]));
      } catch {
        // 没有 people 表
      }

      // 太长就截断，别把上下文塞炸
      const MAX = 60;
      const shown = rows.slice(-MAX);
      const head = shown.length < rows.length ? `（共 ${rows.length} 轮，只显示最后 ${shown.length} 轮）` : `（共 ${rows.length} 轮）`;

      const lines = shown.map((r) => {
        const who = r.role === "user" ? names.get(String(r.speaker_id ?? "")) ?? r.speaker_id ?? "他" : "凝";
        return `${who}：${String(r.text).slice(0, 100).replace(/\n/g, " ")}`;
      });

      return { ok: true, text: [`${day} ${head}`, ...lines].join("\n") };
    },
  };
  registry.register(byDay);

  // ── 学词：梗、黑话、口头禅 ──
  const learnWord: ToolDefinition = {
    name: "learn_word",
    description:
      "遇到不懂的词（梗、黑话、口头禅、缩写）。要么传 meaning 直接记下来（你查到了或者对方解释过），要么只传 term 就会告诉你「不认识」——这时候去问对方。",
    parameters: {
      type: "object",
      properties: {
        term: { type: "string", description: "那个词本身" },
        saidBy: { type: "string", description: "谁说的/谁起的（必须是具体的人：名字或 QQ 号）" },
        meaning: { type: "string", description: "它是什么意思；不知道就别传" },
      },
      required: ["term"],
    },
    handler: async (args) => {
      const term = String(args.term ?? "").trim();
      const meaning = String(args.meaning ?? "").trim();
      if (term.length === 0) return { ok: false, text: "没说要学哪个词" };

      if (!hooks.learn) return { ok: false, text: "现在记不了" };

      const saidBy = String(args.saidBy ?? "").trim();
      if (saidBy.length === 0) {
        return { ok: false, text: "这个说得清是谁说的吗？给我一个具体的人（名字或 QQ 号）。「群友」「某人」不算。" };
      }

      if (meaning.length === 0) {
        // 只问不学：看看词库里有没有
        const known = db.prepare("SELECT 1").get() ? hooks.lookup?.(term) : undefined;
        if (known) return { ok: true, text: `「${term}」= ${known}` };
        return { ok: true, text: `「${term}」我不认识。可以去问对方这是啥意思，问清了再用 learn_word 记下来。` };
      }

      const ok = hooks.learn(term, meaning, saidBy);
      return { ok, text: ok ? `记下了：「${term}」= ${meaning}` : "没记上（可能已经有了）" };
    },
  };
  registry.register(learnWord);
}
