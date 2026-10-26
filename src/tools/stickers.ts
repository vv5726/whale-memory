import { getSticker, prefetchStickers, pruneStickers, stickerDir, stickerStats } from "../stickers.ts";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * 「发个表情包」。
 *
 * 设计取舍：让她自己决定发不发，而不是每条回复自动挂一张——
 * 自动挂会变成刷屏，而且情绪不对的时候图会显得敷衍。
 * 硬闸在 stickers.ts 里：每小时最多 6 张、同一张 30 分钟冷却。
 */
export function registerStickerTools(
  registry: ToolRegistry,
  hooks: { dataDir: string; send?: (filePath: string) => void | Promise<void> },
): void {
  const send: ToolDefinition = {
    name: "sticker_send",
    description:
      "发一张表情包。想笑、无语、委屈、贴贴、安慰的时候用；不需要文字就可以只发表情。库里没有合适的会去搜狗搜（搜到的会存进库，以后能复用）。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "想要的类型/情绪，比如「猫猫无语」「委屈」「贴贴」「晚安」「笑死」。不填就随便挑一张。",
        },
        text: { type: "string", description: "想配一句话（可选，会先发文字再发图）" },
      },
    },
    handler: async (args) => {
      const query = String(args.query ?? "").trim();
      const got = await getSticker(hooks.dataDir, { query });
      if (!got.ok || !got.file) return { ok: false, text: got.text };
      if (!hooks.send) return { ok: false, text: "现在没有正在聊的对话，发不出图。" };
      try {
        await hooks.send(got.file);
        return { ok: true, text: got.text };
      } catch (err) {
        return { ok: false, text: `图找着了但没发出去：${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
  registry.register(send);

  const prefetch: ToolDefinition = {
    name: "sticker_prefetch",
    description:
      "预先下载一批表情包（按情绪关键词去搜狗搜，存进库）。这样真正想发的时候不用等搜索，秒发。库太空或者想换风格时用。",
    parameters: {
      type: "object",
      properties: {
        queries: { type: "string", description: "想补哪些类型，逗号分隔，比如「猫猫,贴贴,无语」；不填就用默认 26 个情绪词" },
        perQuery: { type: "number", description: "每个词存几张（1-6，默认 3）" },
      },
    },
    handler: async (args) => {
      const custom = String(args.queries ?? "").trim();
      const queries = custom
        ? custom.split(/[,，]/).map((s) => s.trim()).filter((s) => s.length > 0)
        : undefined;
      const stats = await prefetchStickers(hooks.dataDir, {
        queries,
        perQuery: Number(args.perQuery ?? 3),
      });
      const s = stickerStats(hooks.dataDir);
      return {
        ok: true,
        text: [
          `新存了 ${stats.added} 张（搜了 ${stats.queries} 个词）`,
          `库存现在 ${s.count} 张，共 ${(s.bytes / 1024 / 1024).toFixed(1)} MB`,
        ].join("\n"),
      };
    },
  };
  registry.register(prefetch);

  const library: ToolDefinition = {
    name: "sticker_library",
    description: "看自己表情包里有什么（条数、用过几张、占多少磁盘），顺便清掉很久没用的。",
    parameters: {
      type: "object",
      properties: { prune: { type: "boolean", description: "true = 顺便清理（收进来一周没用过 / 45 天没用过的）" } },
    },
    handler: async (args) => {
      const removed = args.prune === true ? pruneStickers(hooks.dataDir) : 0;
      const s = stickerStats(hooks.dataDir);
      return {
        ok: true,
        text: [
          `表情包库：${s.count} 张（用过 ${s.used} 张），占 ${(s.bytes / 1024 / 1024).toFixed(1)} MB`,
          `目录：${stickerDir(hooks.dataDir)}`,
          removed > 0 ? `清掉了 ${removed} 张很久没用过的` : "",
        ]
          .filter((x) => x.length > 0)
          .join("\n"),
      };
    },
  };
  registry.register(library);
}
