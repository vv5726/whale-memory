import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

const run = promisify(execFile);

export interface PhoneOptions {
  adbPath: string;
  /** 截图存这里，方便从 QQ 发出去 */
  shotDir: string;
  /** 默认 1 秒内不重复点击同一个位置（防抖动连点） */
  minTapIntervalMs?: number;
}

async function adb(opts: PhoneOptions, args: string[], timeoutMs = 20_000): Promise<string> {
  const { stdout } = await run(opts.adbPath, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

/** 有没有设备连着（USB 或无线都算） */
async function firstDevice(opts: PhoneOptions): Promise<string | null> {
  try {
    const out = await adb(opts, ["devices"]);
    const line = out
      .split(/\r?\n/)
      .slice(1)
      .map((l) => l.trim())
      .find((l) => l.endsWith("\tdevice"));
    return line ? line.split("\t")[0]! : null;
  } catch {
    return null;
  }
}

const NO_DEVICE = "没有连上手机（检查 USB 调试是否打开，或先跑 adb connect）";

/**
 * 不看抖音（2026-10-26 定的）。
 *
 * 为什么拦在工具层，不只写在提示词里：提示词它可能忽略，滑一下就没完，
 * 而且刷抖音那套（开 App → 滑 → 读屏）每次都花掉真实的注意力。
 * 要重新放开，把这两行和下面两处 `if (isDouyin(...))` 删掉就行。
 */
const DOUYIN_APP = /aweme|douyin/i;
const DOUYIN_WORD = /抖音|douyin|aweme|短视频/i;

export function isDouyin(text: string): boolean {
  return DOUYIN_APP.test(text) || DOUYIN_WORD.test(text);
}

const DOUYIN_OFF = "不看抖音——这个定过了，手机上还有别的可玩。";

interface UiNode {
  text: string;
  x: number;
  y: number;
}

/**
 * 把当前界面的控件树 dump 出来，只留「有文字的节点 + 它的中心坐标」。
 *
 * 这是绕开分辨率差异的关键：不同手机坐标不同，但文字是一样的。
 * 代价是慢（1-2 秒），而且界面正在播动画时可能 dump 失败。
 */
async function dumpUi(opts: PhoneOptions, device: string): Promise<UiNode[]> {
  // 息屏时 uiautomator 会报 "null root node"，先唤醒再读
  try {
    const power = await adb(opts, ["-s", device, "shell", "dumpsys", "power"], 10_000);
    if (power.includes("mWakefulness=Asleep")) {
      await adb(opts, ["-s", device, "shell", "input", "keyevent", "KEYCODE_WAKEUP"], 10_000);
      await new Promise((r) => setTimeout(r, 800));
    }
  } catch {
    // 唤不醒也继续尝试，让后面的报错自己说话
  }

  const remote = "/sdcard/whale_ui.xml";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await adb(opts, ["-s", device, "shell", "uiautomator", "dump", remote], 15_000);
      const xml = await adb(opts, ["-s", device, "shell", "cat", remote], 15_000);
      const nodes: UiNode[] = [];
      for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
        const tag = m[0];
        const textM = /\btext="([^"]*)"/.exec(tag);
        const boundsM = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
        if (!textM || !boundsM) continue;
        const text = textM[1] ?? "";
        if (text.trim().length === 0) continue;
        const [x1, y1, x2, y2] = [Number(boundsM[1]), Number(boundsM[2]), Number(boundsM[3]), Number(boundsM[4])];
        nodes.push({ text, x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) });
      }
      return nodes;
    } catch {
      if (attempt === 1) return [];
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return [];
}

/**
 * 注册手机控制工具。
 *
 * 全部走 adb 自带能力，不引入任何依赖。
 * 截图不直接返回图像——把文件路径给模型，让它决定要不要发出去。
 */
export function registerPhoneTools(registry: ToolRegistry, opts: PhoneOptions): void {
  mkdirSync(opts.shotDir, { recursive: true });

  const tools: ToolDefinition[] = [
    {
      name: "phone_status",
      description: "查看手机是否连上、屏幕分辨率、系统版本。做任何手机操作前先调这个确认。",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const device = await firstDevice(opts);
        if (!device) return { ok: false, text: NO_DEVICE };
        const size = (await adb(opts, ["-s", device, "shell", "wm", "size"])).trim();
        const ver = (await adb(opts, ["-s", device, "shell", "getprop", "ro.build.version.release"])).trim();
        return { ok: true, text: `已连接 ${device}　分辨率 ${size.replace("Physical size: ", "")}　安卓 ${ver}` };
      },
    },
    {
      name: "phone_screenshot",
      description: "给当前屏幕拍一张截图，保存到本地并返回文件路径。用于看清当前在哪个界面。",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const device = await firstDevice(opts);
        if (!device) return { ok: false, text: NO_DEVICE };
        const name = `shot-${Date.now()}.png`;
        const path = join(opts.shotDir, name);
        const { stdout } = await run(opts.adbPath, ["-s", device, "exec-out", "screencap", "-p"], {
          timeout: 30_000,
          maxBuffer: 32 * 1024 * 1024,
          encoding: "buffer",
        });
        writeFileSync(path, stdout);
        return { ok: true, text: `截图已保存：${path}（${Math.round(stdout.length / 1024)} KB）` };
      },
    },
    {
      name: "phone_tap",
      description: "点击屏幕上的一个坐标。坐标以 phone_status 返回的分辨率为准。",
      parameters: {
        type: "object",
        properties: {
          x: { type: "integer", description: "横坐标" },
          y: { type: "integer", description: "纵坐标" },
        },
        required: ["x", "y"],
      },
      handler: async (args) => {
        const device = await firstDevice(opts);
        if (!device) return { ok: false, text: NO_DEVICE };
        const x = Math.round(Number(args.x));
        const y = Math.round(Number(args.y));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, text: "坐标不合法" };
        await adb(opts, ["-s", device, "shell", "input", "tap", String(x), String(y)]);
        return { ok: true, text: `点了 (${x}, ${y})` };
      },
    },
    {
      name: "phone_swipe",
      description: "滑动屏幕。翻下一个视频、翻页、滚列表都用它（起点 y 大、终点 y 小是往上翻）。",
      parameters: {
        type: "object",
        properties: {
          x1: { type: "integer" },
          y1: { type: "integer" },
          x2: { type: "integer" },
          y2: { type: "integer" },
          durationMs: { type: "integer", description: "滑动时长，默认 300 毫秒" },
        },
        required: ["x1", "y1", "x2", "y2"],
      },
      handler: async (args) => {
        const device = await firstDevice(opts);
        if (!device) return { ok: false, text: NO_DEVICE };
        const n = (v: unknown, d: number): number => {
          const x = Number(v);
          return Number.isFinite(x) ? Math.round(x) : d;
        };
        const dur = n(args.durationMs, 300);
        await adb(opts, [
          "-s", device, "shell", "input", "swipe",
          String(n(args.x1, 0)), String(n(args.y1, 0)), String(n(args.x2, 0)), String(n(args.y2, 0)), String(dur),
        ]);
        return { ok: true, text: `从 (${n(args.x1, 0)},${n(args.y1, 0)}) 滑到 (${n(args.x2, 0)},${n(args.y2, 0)})` };
      },
    },
    {
      name: "phone_type",
      description: "在当前输入框里打字。中文需要输入法支持，纯英文数字最稳。",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "要输入的文字" } },
        required: ["text"],
      },
      handler: async (args) => {
        const device = await firstDevice(opts);
        if (!device) return { ok: false, text: NO_DEVICE };
        const text = String(args.text ?? "");
        if (text.length === 0) return { ok: false, text: "没有要输入的内容" };
        // 中文和空格：adb input text 打不了（它只认 ASCII）。
        // 装一个 ADB 键盘（com.android.adbkeyboard），临时切过去用广播发 Unicode，
        // 打完再切回用户自己的输入法，不打扰他正常用手机。
        const ADB_IME = "com.android.adbkeyboard/.AdbIME";
        const hasCjk = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(text);

        if (hasCjk) {
          let original = "";
          try {
            original = (await adb(opts, ["-s", device, "shell", "settings", "get", "secure", "default_input_method"])).trim();
            await adb(opts, ["-s", device, "shell", "ime", "enable", ADB_IME]);
            await adb(opts, ["-s", device, "shell", "ime", "set", ADB_IME]);
            await new Promise((r) => setTimeout(r, 300));
            await adb(opts, ["-s", device, "shell", "am", "broadcast", "-a", "ADB_INPUT_TEXT", "--es", "msg", text]);
          } catch {
            // 切不过去就退回 ASCII 输入法
            await adb(opts, ["-s", device, "shell", "input", "text", text.replace(/[^\x20-\x7e]/g, "").replace(/ /g, "%s")]);
          } finally {
            if (original && original.includes("/")) {
              await adb(opts, ["-s", device, "shell", "ime", "set", original]).catch(() => undefined);
            }
          }
        } else {
          await adb(opts, ["-s", device, "shell", "input", "text", text.replace(/ /g, "%s")]);
        }

        // 打完自己回看一眼：字还在屏幕上吗？
        // 不在输入框里 = 很可能已经发出去了。
        // 以前它不知道自己发出去了，就是因为工具只回「输入了 4 个字符」。
        await new Promise((r) => setTimeout(r, 600));
        let verdict = "打进去了，但没确认有没有发出去。";
        try {
          const nodes = await dumpUi(opts, device);
          const screen = nodes.map((n) => n.text ?? "").join(" ");
          const stillThere = screen.includes(text) || screen.includes(text.replace(/\s+/g, ""));
          const hasSend = /发送|send/i.test(screen);
          const looksChat = /聊天|消息|群|好友|发送/i.test(screen);
          if (stillThere) {
            verdict = hasSend
              ? "字还在输入框里，旁边有「发送」——还没发出去，要发就点它。"
              : "字已经打进去了。";
          } else if (looksChat) {
            verdict = "字不在屏幕上了，而且这看着是聊天界面——很可能已经发出去了，对方已经看到。";
          } else {
            verdict = "字不在屏幕上了（可能已经提交）。";
          }
        } catch {
          // 读不到屏就只报告输入成功
        }

        return { ok: true, text: `输入了 ${text.length} 个字符。${verdict}` };
      },
    },
    {
      name: "phone_key",
      description: "按系统按键。常用：home 回桌面、back 返回、recents 最近任务、power 电源。",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "home / back / recents / power / volume_up / volume_down" },
        },
        required: ["key"],
      },
      handler: async (args) => {
        const device = await firstDevice(opts);
        if (!device) return { ok: false, text: NO_DEVICE };
        const map: Record<string, string> = {
          home: "3",
          back: "4",
          recents: "187",
          power: "26",
          volume_up: "24",
          volume_down: "25",
        };
        const code = map[String(args.key).toLowerCase()];
        if (!code) return { ok: false, text: `不认识的按键：${args.key}` };
        await adb(opts, ["-s", device, "shell", "input", "keyevent", code]);
        return { ok: true, text: `按了 ${args.key}` };
      },
    },
    {
      name: "phone_open_app",
      description: "按应用包名启动一个 App。QQ 是 com.tencent.mobileqq，B 站是 tv.danmaku.bili。",
      parameters: {
        type: "object",
        properties: { package: { type: "string", description: "应用包名" } },
        required: ["package"],
      },
      handler: async (args) => {
        const pkg = String(args.package ?? "").trim();
        if (!/^[a-zA-Z0-9._]+$/.test(pkg)) return { ok: false, text: "包名不合法" };
        if (isDouyin(pkg)) return { ok: false, text: DOUYIN_OFF };
        const device = await firstDevice(opts);
        if (!device) return { ok: false, text: NO_DEVICE };
        const out = await adb(opts, ["-s", device, "shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
        if (out.includes("No activities found")) return { ok: false, text: `手机上没有装 ${pkg}` };
        return { ok: true, text: `启动了 ${pkg}` };
      },
    },
    {
      name: "phone_current_app",
      description: "查看当前在前台的是哪个 App，用来判断操作有没有生效。",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const device = await firstDevice(opts);
        if (!device) return { ok: false, text: NO_DEVICE };
        const out = await adb(opts, ["-s", device, "shell", "dumpsys", "window"]);
        const m = /mCurrentFocus=.*?\s([a-zA-Z0-9._]+)\//.exec(out) ?? /mFocusedApp=.*?\s([a-zA-Z0-9._]+)\//.exec(out);
        return m ? { ok: true, text: `当前前台：${m[1]}` } : { ok: true, text: "看不出当前是哪个 App" };
      },
    },
    {
      name: "phone_dump_ui",
      description:
        "读取当前屏幕上的所有文字（按钮、标题、评论、热搜话题等）。比截图更有用：这是结构化的文字，不消耗视觉能力。看页面文案、找按钮的坐标都用它。",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const device = await firstDevice(opts);
        if (!device) return { ok: false, text: NO_DEVICE };
        const nodes = await dumpUi(opts, device);
        if (nodes.length === 0) return { ok: true, text: "屏幕上没有可读文字（可能在播视频，或界面还在加载）" };
        // 去重并按出现顺序排，限制条数防止灌爆上下文
        const seen = new Set<string>();
        const lines: string[] = [];
        for (const n of nodes) {
          const t = n.text.replace(/\s+/g, " ").trim();
          if (t.length === 0 || seen.has(t)) continue;
          seen.add(t);
          lines.push(`${t}　@(${n.x},${n.y})`);
          if (lines.length >= 40) break;
        }
        return { ok: true, text: `屏幕文字 ${lines.length} 条：\n${lines.join("\n")}` };
      },
    },
    {
      name: "phone_tap_text",
      description:
        "按文字找按钮并点击，比如点「热搜」「评论」「发送」。比记坐标可靠得多——不同手机分辨率不同，坐标会飘，文字不会。",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "要点击的文字，可以只写一部分" },
          exact: { type: "boolean", description: "是否要求完全一致，默认 false（包含即可）" },
        },
        required: ["text"],
      },
      handler: async (args) => {
        const want = String(args.text ?? "").trim();
        if (want.length === 0) return { ok: false, text: "没说要点击什么文字" };
        if (isDouyin(want)) return { ok: false, text: DOUYIN_OFF };
        const device = await firstDevice(opts);
        if (!device) return { ok: false, text: NO_DEVICE };
        const nodes = await dumpUi(opts, device);
        const exact = args.exact === true;
        const hit = nodes.find((n) => (exact ? n.text.trim() === want : n.text.includes(want)));
        if (!hit) {
          const sample = nodes.slice(0, 8).map((n) => n.text.trim()).filter(Boolean).join("、");
          return { ok: false, text: `屏幕上没找到「${want}」。现在能看到的有：${sample || "（空）"}` };
        }
        await adb(opts, ["-s", device, "shell", "input", "tap", String(hit.x), String(hit.y)]);
        return { ok: true, text: `点了「${hit.text.trim()}」@(${hit.x},${hit.y})` };
      },
    },
  ];

  for (const tool of tools) registry.register(tool);
}

/** 截图目录里最近的几张（给「发截图到 QQ」用） */
export function latestScreenshots(dir: string, count = 3): string[] {
  if (!existsSync(dir)) return [];
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(dir)
    .filter((f) => f.startsWith("shot-") && f.endsWith(".png"))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, count)
    .map((x) => join(dir, x.f));
}

void readFileSync;

/** 它自己对手机操作的说明书——不是给我看的，是给模型看的 */
const PHONE_GUIDE = `【怎么用这台手机】

基本循环永远是这三步：
  1. phone_current_app —— 我现在在哪个 App
  2. phone_dump_ui      —— 屏幕上有什么（每行文字后面带坐标）
  3. phone_tap / phone_type / phone_key —— 对着看到的坐标动手
做完再 dump 一次，看有没有变化。**别凭印象点坐标**。

坐标怎么来：
  dump_ui 返回的每行是「文字　@(x,y)」。点那个坐标就是点那段文字。
  没有你要点的文字，就用 phone_screenshot 看一眼，或者往下滑（phone_swipe）。

打字：
  点一下输入框（通常是屏幕最下面那一行），再 phone_type。
  **中文现在能打了**——工具会自动切输入法，你不用管。
  打完它会告诉你字还在不在输入框里。不在 = 多半已经发出去了。

常见的几个动作：
  返回上一页        phone_key back
  回桌面            phone_key home
  看聊天记录        dump_ui，往上滑
  发消息            点输入框 → phone_type → 点「发送」或按回车

注意：
  - 每次只做一步，做完看一眼再决定下一步。连点两次同一个地方很容易点错。
  - 卡住了就按 back 退出来，重新看一遍屏幕。
  - 屏幕黑了会自己唤醒，但可能停在锁屏——那要先上滑解锁。`;


export function registerPhoneGuide(registry: ToolRegistry): void {
  registry.register({
    name: "phone_guide",
    description: "怎么用这台手机：操作顺序、坐标怎么读、打字怎么打、常见动作。不确定怎么操作时先读它。",
    parameters: { type: "object", properties: {} },
    handler: async () => ({ ok: true, text: PHONE_GUIDE }),
  });
}