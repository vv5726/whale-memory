import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/** 当前时间。看起来最没用，但模型不知道今天是几号——这一条能让“今天”“昨天”有意义。 */
export function registerBasicTools(registry: ToolRegistry): void {
  const timeTool: ToolDefinition = {
    name: "get_time",
    description: "获取当前的日期、时间和星期。回答涉及今天/昨天/最近/多久了之前，先调这个。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const now = new Date();
      const week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
      const pad = (n: number) => String(n).padStart(2, "0");
      return {
        ok: true,
        text: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${week} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
      };
    },
  };
  registry.register(timeTool);
}
