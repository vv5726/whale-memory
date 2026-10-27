# -*- coding: utf-8 -*-
"""抖音图文：行为逻辑（走神）+ 三合一（自主性与自我修改）。1080x1440。"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = r"C:\Users\Administrator\Documents\deepseek-harness\default-workspace\whale-memory"
OUT_BEHAVIOR = os.path.join(ROOT, "docs", "douyin-behavior")
OUT_ALL = os.path.join(ROOT, "docs", "douyin-all")

F = r"C:\Windows\Fonts\msyh.ttc"
FB = r"C:\Windows\Fonts\msyhbd.ttc"
def font(sz, bold=False):
    return ImageFont.truetype(FB if bold else F, sz, index=0)

W, H = 1080, 1440
PAD = 76
BG = (251, 252, 254)
INK = (26, 30, 36)
MUTED = (122, 130, 140)
LINE = (228, 232, 238)
BLUE = (47, 111, 237)
ORANGE = (232, 148, 24)
PURPLE = (122, 90, 248)
GREEN = (22, 160, 100)
RED = (200, 60, 60)
SOFT = (244, 248, 255)
PUNCT = "。，、；：？！）」』…"

def new_page():
    img = Image.new("RGB", (W, H), BG)
    return img, ImageDraw.Draw(img)

def wrap(d, text, fnt, max_w):
    out = []
    for para in str(text).split("\n"):
        cur = ""
        for ch in para:
            if d.textlength(cur + ch, font=fnt) <= max_w:
                cur += ch
            elif ch in PUNCT and cur:
                cur += ch
            else:
                out.append(cur)
                cur = ch
        out.append(cur)
    return out

def footer(d, idx, total, brand):
    d.line([(PAD, H - 96), (W - PAD, H - 96)], fill=LINE, width=2)
    d.text((PAD, H - 74), brand, font=font(24), fill=MUTED)
    t = f"{idx}/{total}"
    d.text((W - PAD - d.textlength(t, font=font(24)), H - 74), t, font=font(24), fill=MUTED)

def header(d, no, title, accent=BLUE):
    y = PAD + 10
    d.rounded_rectangle([PAD, y, PAD + 96, y + 62], radius=16, fill=accent)
    d.text((PAD + 20, y + 8), no, font=font(38, True), fill=(255, 255, 255))
    ty = y + 96
    for line in wrap(d, title, font(60, True), W - PAD * 2):
        d.text((PAD, ty), line, font=font(60, True), fill=INK)
        ty += 80
    d.line([(PAD, ty + 12), (PAD + 120, ty + 12)], fill=accent, width=6)
    return ty + 54

def para(d, y, text, sz=34, color=None, gap=None):
    gap = gap or int(sz * 1.42)
    for line in wrap(d, text, font(sz), W - PAD * 2):
        d.text((PAD, y), line, font=font(sz), fill=color or INK)
        y += gap
    return y

def bullets(d, y, items, sz=38, gap=26, accent=BLUE, sub_sz=30):
    fnt, sub = font(sz), font(sub_sz)
    for head, body in items:
        d.ellipse([PAD, y + 14, PAD + 14, y + 28], fill=accent)
        for line in wrap(d, head, fnt, W - PAD * 2 - 40):
            d.text((PAD + 38, y), line, font=fnt, fill=INK)
            y += int(sz * 1.45)
        if body:
            for line in wrap(d, body, sub, W - PAD * 2 - 40):
                d.text((PAD + 38, y), line, font=sub, fill=MUTED)
                y += int(sub_sz * 1.45)
        y += gap
    return y

def callout(d, y, big, label, color, h=190):
    d.rounded_rectangle([PAD, y, W - PAD, y + h], radius=20, fill=(255, 255, 255), outline=LINE, width=2)
    d.rounded_rectangle([PAD, y, PAD + 12, y + h], radius=6, fill=color)
    d.text((PAD + 34, y + 28), big, font=font(62, True), fill=color)
    for j, line in enumerate(wrap(d, label, font(30), W - PAD * 2 - 60)):
        d.text((PAD + 34, y + 112 + j * 42), line, font=font(30), fill=INK)
    return y + h + 20

def row_card(d, y, head, note, right, color, h=118):
    d.rounded_rectangle([PAD, y, W - PAD, y + h], radius=16, fill=(255, 255, 255), outline=LINE, width=2)
    d.rounded_rectangle([PAD, y, PAD + 10, y + h], radius=5, fill=color)
    d.text((PAD + 28, y + 16), head, font=font(30, True), fill=INK)
    if note:
        d.text((PAD + 28, y + 64), note, font=font(24), fill=MUTED)
    if right:
        d.text((W - PAD - 26 - d.textlength(right, font=font(28, True)), y + 40), right, font=font(28, True), fill=color)
    return y + h + 12

def bar_row(d, y, label, note, value, frac, color):
    width = W - PAD * 2
    d.text((PAD, y), label, font=font(30, True), fill=INK)
    d.text((PAD + width - d.textlength(value, font=font(32, True)), y - 2), value, font=font(32, True), fill=color)
    ty = y + 48
    d.rounded_rectangle([PAD, ty, PAD + width, ty + 20], radius=10, fill=(238, 241, 246))
    d.rounded_rectangle([PAD, ty, PAD + max(20, int(width * frac)), ty + 20], radius=10, fill=color)
    if note:
        d.text((PAD, ty + 34), note, font=font(24), fill=MUTED)
        return ty + 34 + 42
    return ty + 56

def cover_page(d, kicker, lines, sub, kpis, strip, brand, idx, total):
    d.text((PAD, PAD + 20), kicker, font=font(30, True), fill=BLUE)
    y = PAD + 150
    for line in lines:
        d.text((PAD, y), line, font=font(92, True), fill=INK)
        y += 122
    y += 24
    y = para(d, y, sub, 38, MUTED, 58)
    y += 40
    cw, gap = (W - PAD * 2 - 3 * 16) // 4, 16
    for i, (big, small, color) in enumerate(kpis):
        x = PAD + i * (cw + gap)
        d.rounded_rectangle([x, y, x + cw, y + 160], radius=18, fill=(255, 255, 255), outline=LINE, width=2)
        d.text((x + 16, y + 22), big, font=font(34, True), fill=color)
        for j, line in enumerate(wrap(d, small, font(22), cw - 32)):
            d.text((x + 16, y + 86 + j * 28), line, font=font(22), fill=MUTED)
    y += 200
    if strip:
        sw = (W - PAD * 2 - (len(strip) - 1) * 12) // len(strip)
        for i, s in enumerate(strip):
            x = PAD + i * (sw + 12)
            d.rounded_rectangle([x, y, x + sw, y + 74], radius=14, fill=SOFT, outline=(210, 224, 255), width=2)
            tw = d.textlength(s, font=font(25, True))
            d.text((x + (sw - tw) / 2, y + 22), s, font=font(25, True), fill=BLUE)
            if i < len(strip) - 1:
                d.text((x + sw + 2, y + 18), "›", font=font(32, True), fill=(180, 190, 205))
    footer(d, idx, total, brand)

def end_page(d, kicker, lines, sub, extra, brand, idx, total):
    d.text((PAD, 330), kicker, font=font(30, True), fill=BLUE)
    y = 420
    for line in lines:
        d.text((PAD, y), line, font=font(70, True), fill=INK)
        y += 102
    y += 40
    y = para(d, y, sub, 32, MUTED, 50)
    if extra:
        y += 26
        d.line([(PAD, y), (PAD + 120, y)], fill=BLUE, width=6)
        y += 32
        para(d, y, extra, 30, INK, 46)
    footer(d, idx, total, brand)


# ================= 行为逻辑（走神） =================
def behavior_pages():
    pages = []

    def cover(d, idx, total):
        cover_page(
            d, "行为逻辑",
            ["她不只会回话，", "还会自己想事"],
            "安静的时候她会走神；太久没聊她会主动开口；每 6 分钟还可能自己干点什么。",
            [("30 秒", "安静多久开始走神", BLUE), ("85%", "每次走神的概率", ORANGE), ("6 分钟", "自主活动间隔", PURPLE), ("74 个", "能用的工具", GREEN)],
            ["走神", "判断", "说 or 不说", "动手", "记下来"],
            "行为逻辑 · 2026.10", idx, total,
        )
    pages.append(cover)

    def s01(d, idx, total):
        y = header(d, "01", "三种「自己动」")
        y = para(d, y, "回应别人只是其中一种。她还有三种不等人叫的行为，各有各的触发条件。", 32, MUTED)
        y += 14
        y = row_card(d, y, "走神", "安静 30 秒后，按 85% 概率想起一件事", "今天 27 次", BLUE)
        y = row_card(d, y, "主动开口", "45 分钟没说话，可能主动找你（不限次数）", "今天 1 次", ORANGE)
        y = row_card(d, y, "自主活动", "每 6 分钟一轮，可以干活：查 B 站、摸手机、整理记忆", "今天 13 次", PURPLE)
        y += 14
        y = para(d, y, "这些都不需要你发消息触发——是她自己的日程。", 30, INK)
        footer(d, idx, total, "行为逻辑 · 2026.10")
    pages.append(s01)

    def s02(d, idx, total):
        y = header(d, "02", "走神：安静 30 秒，82% 概率")
        y = para(d, y, "上一次说完话、安静满 30 秒，就开始一轮「走神」。两轮之间隔 1.5–3.5 分钟，不会一直想。", 32, MUTED)
        y += 24
        y = bar_row(d, y, "走神概率", "85% 会想一件事，剩下的就是安静待着", "85%", 0.85, BLUE)
        y = bar_row(d, y, "两轮间隔", "1.5 – 3.5 分钟随机", "1.5–3.5 分", 0.45, ORANGE)
        y = bar_row(d, y, "想到之后先冷静", "90 秒，避免一冲动就动手", "90 秒", 0.3, PURPLE)
        y += 10
        y = para(d, y, "走神的内容不是随机的：她从记忆里挑一件最近比较重的事，再看此刻要不要做点什么。", 30, INK)
        footer(d, idx, total, "行为逻辑 · 2026.10")
    pages.append(s02)

    def s03(d, idx, total):
        y = header(d, "03", "走神的三个出口")
        y = para(d, y, "想起一件事之后，她只做三选一：什么都不做、说一句、或者动手。", 32, MUTED)
        y += 16
        exits = [
            ("① 不做", "「没走神：想起 XX，但没什么要做的」", BLUE),
            ("② 说一句", "写给谁、说什么，走投递（还会过额度闸）", ORANGE),
            ("③ 动手", "调工具：查 B 站、看手机、整理记忆、写笔记", PURPLE),
        ]
        for head, note, color in exits:
            d.rounded_rectangle([PAD, y, W - PAD, y + 150], radius=18, fill=(255, 255, 255), outline=LINE, width=2)
            d.rounded_rectangle([PAD, y, PAD + 10, y + 150], radius=5, fill=color)
            d.text((PAD + 28, y + 20), head, font=font(34, True), fill=color)
            for j, line in enumerate(wrap(d, note, font(26), W - PAD * 2 - 60)):
                d.text((PAD + 28, y + 76 + j * 38), line, font=font(26), fill=INK)
            y += 164
        y += 10
        y = para(d, y, "三个出口里，最常走的是第一个。", 30, MUTED)
        footer(d, idx, total, "行为逻辑 · 2026.10")
    pages.append(s03)

    def s04(d, idx, total):
        y = header(d, "04", "「不做」也是决定")
        y = para(d, y, "今天她走了 27 次神，真正开口只有 1 次。这不是没在想，是想了之后判断：这会儿不该说。", 32, MUTED)
        y += 24
        y = bar_row(d, y, "走神 27 次", "想起一件事、权衡要不要做", "27", 1.0, BLUE)
        y = bar_row(d, y, "其中「没走神」", "判断为「没什么要做的」", "26", 26 / 27, MUTED)
        y = bar_row(d, y, "真正开口", "主动找你说话", "1", 1 / 27, ORANGE)
        y += 16
        y = callout(d, y, "96%", "的走神以「什么都不做」结束 —— 这才是自主，不是话多", GREEN)
        footer(d, idx, total, "行为逻辑 · 2026.10")
    pages.append(s04)

    def s05(d, idx, total):
        y = header(d, "05", "主动开口：45 分钟没聊")
        y = para(d, y, "你 45 分钟没说话，她可能主动找你一句。次数不限，但要过两道闸：钱和「现在合不合适」。", 32, MUTED)
        y += 20
        y = bullets(d, y, [
            ("45 分钟", "太短会烦人，太长就断了；这个数可以自己调"),
            ("不限次数，但受额度限制", "每天 50 元封顶，超了就不说话"),
            ("说什么由她定", "从记忆里找一件「还没说完的事」"),
        ], gap=24)
        footer(d, idx, total, "行为逻辑 · 2026.10")
    pages.append(s05)

    def s06(d, idx, total):
        y = header(d, "06", "自主活动：每 6 分钟一轮")
        y = para(d, y, "比走神更重的一档：她会真的动手做点事，做完把结果写回记忆。", 32, MUTED)
        y += 16
        acts = [
            ("翻 B 站", "热点、字幕、评论，挑值得看的写进记忆", ORANGE),
            ("摸手机", "截图看一眼屏幕上是什么，有时顺手点两下", PURPLE),
            ("整理记忆", "抽取、合并、压缩、算情绪", BLUE),
            ("写东西", "笔记、计划、自我评价", GREEN),
        ]
        for head, note, color in acts:
            d.rounded_rectangle([PAD, y, W - PAD, y + 122], radius=16, fill=(255, 255, 255), outline=LINE, width=2)
            d.rounded_rectangle([PAD, y, PAD + 10, y + 122], radius=5, fill=color)
            d.text((PAD + 28, y + 18), head, font=font(32, True), fill=INK)
            d.text((PAD + 28, y + 68), note, font=font(25), fill=MUTED)
            y += 134
        footer(d, idx, total, "行为逻辑 · 2026.10")
    pages.append(s06)

    def s07(d, idx, total):
        y = header(d, "07", "她凭什么决定？")
        y = para(d, y, "四样东西喂给她，她再决定做不做：", 32, MUTED)
        y += 16
        y = row_card(d, y, "① 记忆", "最近比较重的事、还没收尾的事", "来源", BLUE, 108)
        y = row_card(d, y, "② 心境", "她现在是什么情绪，三档衰减", "状态", ORANGE, 108)
        y = row_card(d, y, "③ 日程", "有没有快到期的计划、待办", "任务", PURPLE, 108)
        y = row_card(d, y, "④ 刚才的对话", "说到一半的话题，最可能被接着想", "上下文", GREEN, 108)
        y += 16
        y = para(d, y, "她自己写的规矩（对话风格、什么不该说）也在这一层里。", 30, INK)
        footer(d, idx, total, "行为逻辑 · 2026.10")
    pages.append(s07)

    def s08(d, idx, total):
        y = header(d, "08", "想动之前，先过五道闸")
        y = para(d, y, "自主不等于放肆。每一轮都得先过这几道：", 32, MUTED)
        y += 16
        gates = [
            ("钱", "今天额度用完了就闭嘴", BLUE),
            ("时间", "0–24 点都在跑，但深夜不说话", ORANGE),
            ("场合", "群里只在被 @ 或策略允许时开口", PURPLE),
            ("审批", "要动手改大东西时先问你", GREEN),
            ("冷却", "刚说完不重复说", RED),
        ]
        for head, note, color in gates:
            d.rounded_rectangle([PAD, y, W - PAD, y + 112], radius=16, fill=(255, 255, 255), outline=LINE, width=2)
            d.rounded_rectangle([PAD, y, PAD + 10, y + 112], radius=5, fill=color)
            d.text((PAD + 28, y + 14), head, font=font(30, True), fill=INK)
            d.text((PAD + 28, y + 60), note, font=font(24), fill=MUTED)
            y += 124
        footer(d, idx, total, "行为逻辑 · 2026.10")
    pages.append(s08)

    def s09(d, idx, total):
        y = header(d, "09", "她想动，用什么动")
        y = para(d, y, "74 个工具，按用途分四类：", 32, MUTED)
        y += 16
        groups = [
            ("看世界", "查时间、看手机屏幕、翻 B 站、读图片、看日志", "18 个", BLUE),
            ("记事情", "存记忆、改情绪、写笔记、钉计划、管词库", "22 个", ORANGE),
            ("说话", "发消息、发表情包、群里 @ 人", "3 个", PURPLE),
            ("改自己", "改人格、改说话规矩、改抽取提示词、调参", "12 个", GREEN),
        ]
        for head, note, count, color in groups:
            d.rounded_rectangle([PAD, y, W - PAD, y + 132], radius=16, fill=(255, 255, 255), outline=LINE, width=2)
            d.rounded_rectangle([PAD, y, PAD + 10, y + 132], radius=5, fill=color)
            d.text((PAD + 28, y + 16), head, font=font(32, True), fill=INK)
            d.text((W - PAD - 26 - d.textlength(count, font=font(26, True)), y + 20), count, font=font(26, True), fill=color)
            for j, line in enumerate(wrap(d, note, font(24), W - PAD * 2 - 60)):
                d.text((PAD + 28, y + 66 + j * 34), line, font=font(24), fill=MUTED)
            y += 144
        footer(d, idx, total, "行为逻辑 · 2026.10")
    pages.append(s09)

    def s10(d, idx, total):
        y = header(d, "10", "这些都能调")
        rows = [
            ("走神开关 / 概率", "thinkEnabled / thinkChance", "开 · 85%"),
            ("安静多久走神", "thinkIdleSeconds", "30 秒"),
            ("两轮间隔", "thinkGapMin/MaxMinutes", "1.5–3.5 分"),
            ("自主活动间隔", "autonomyMinutes", "6 分钟"),
            ("主动开口门槛", "proactiveIdleMinutes", "45 分钟"),
            ("每日额度", "dailyBudgetYuan", "50 元"),
        ]
        for name, key, val in rows:
            d.line([(PAD, y + 118), (W - PAD, y + 118)], fill=LINE, width=2)
            d.text((PAD, y + 14), name, font=font(32, True), fill=INK)
            d.text((PAD, y + 62), key, font=font(23), fill=MUTED)
            d.text((W - PAD - d.textlength(val, font=font(30, True)), y + 20), val, font=font(30, True), fill=BLUE)
            y += 122
        footer(d, idx, total, "行为逻辑 · 2026.10")
    pages.append(s10)

    def end(d, idx, total):
        end_page(
            d, "一句话",
            ["自主不是话多，", "是自己决定", "什么时候不说话。"],
            "27 次走神，1 次开口 —— 剩下的 26 次，都是她判断「这会儿不该说」。",
            "会想、会判断、会忍住，才叫在自己过日子。",
            "行为逻辑 · 2026.10", idx, total,
        )
    pages.append(end)
    return pages


# ================= 三合一（自主性与自我修改） =================
def all_pages():
    pages = []

    def cover(d, idx, total):
        cover_page(
            d, "记忆 × 行为 × 自我修改",
            ["三套连起来看，", "她才像个人"],
            "记忆是事实，行为是输出，自我修改是「改自己」——三样围成一个环。",
            [("3.9 年", "记忆能撑多久", BLUE), ("27 次", "今天走神次数", ORANGE), ("12 类", "她能改自己的工具", PURPLE), ("74 个", "工具总数", GREEN)],
            ["记忆", "行为", "改自己", "新记忆", "新行为"],
            "记忆 × 行为 × 自我修改 · 2026.10", idx, total,
        )
    pages.append(cover)

    def s01(d, idx, total):
        y = header(d, "01", "一个环，不是三条线")
        y = para(d, y, "记忆喂给她做什么，做的结果又变成新记忆；改了自己之后，下一次的判断也不一样了。", 32, MUTED)
        y += 20
        # 环形图
        cx, cy, r = W // 2, y + 280, 210
        labels = [("记忆", 0, BLUE), ("行为", 1, ORANGE), ("自我修改", 2, PURPLE), ("新记忆", 3, GREEN)]
        import math
        pts = []
        for label, i, color in labels:
            ang = -math.pi / 2 + i * math.pi / 2
            px, py = cx + int(r * math.cos(ang)), cy + int(r * math.sin(ang))
            pts.append((px, py, label, color))
        for i in range(4):
            x1, y1, _, _ = pts[i]
            x2, y2, _, _ = pts[(i + 1) % 4]
            d.line([(x1, y1), (x2, y2)], fill=(190, 200, 215), width=4)
            # 箭头：画在这条线的 62% 处，指示方向
            import math as _m
            mx, my = x1 + (x2 - x1) * 0.62, y1 + (y2 - y1) * 0.62
            ang = _m.atan2(y2 - y1, x2 - x1)
            size = 16
            d.polygon(
                [(mx + size * _m.cos(ang), my + size * _m.sin(ang)),
                 (mx + size * _m.cos(ang + 2.5), my + size * _m.sin(ang + 2.5)),
                 (mx + size * _m.cos(ang - 2.5), my + size * _m.sin(ang - 2.5))],
                fill=(150, 162, 180),
            )
        for px, py, label, color in pts:
            w = 230 if len(label) <= 3 else 250
            d.rounded_rectangle([px - w // 2, py - 44, px + w // 2, py + 44], radius=16, fill=(255, 255, 255), outline=color, width=4)
            tw = d.textlength(label, font=font(28, True))
            d.text((px - tw / 2, py - 20), label, font=font(28, True), fill=color)
        y = cy + 300
        y = para(d, y, "这个环里，没有一步是「等别人叫她」才发生的。", 30, INK)
        footer(d, idx, total, "记忆 × 行为 × 自我修改 · 2026.10")
    pages.append(s01)

    def s02(d, idx, total):
        y = header(d, "02", "环的一边：记忆 → 行为")
        y = para(d, y, "她做什么，取决于她记得什么。同一个问题，记得不同的事，回得完全不同。", 32, MUTED)
        y += 20
        y = bullets(d, y, [
            ("先想起，再决定", "每次开口前先检索：这件事以前发生过吗"),
            ("记忆带情绪", "同样是旧事，难受的那件更容易被翻出来"),
            ("没想起来 = 真不知道", "不是装作不记得，是检索没命中"),
        ], gap=26)
        y += 6
        y = callout(d, y, "1,200 token", "每次只挑最相关的几条记忆进上下文，超了就从分数低的开始丢", BLUE)
        footer(d, idx, total, "记忆 × 行为 × 自我修改 · 2026.10")
    pages.append(s02)

    def s03(d, idx, total):
        y = header(d, "03", "环的另一边：行为 → 记忆")
        y = para(d, y, "她做过的每件事都会回到记忆里：说过的话、查过的东西、想过的事。", 32, MUTED)
        y += 18
        y = row_card(d, y, "说出去的话", "存成一条对话，带「发到哪」", "落库", BLUE)
        y = row_card(d, y, "动手做的事", "查到的内容、看到的屏幕，抽成记忆", "落库", ORANGE)
        y = row_card(d, y, "走神想的事", "走神本身不入库，只有判断「要做」才动手", "不入库", PURPLE)
        y += 12
        y = para(d, y, "所以她第二天的「今天」里，会有自己昨天干过的事。", 30, INK)
        footer(d, idx, total, "记忆 × 行为 × 自我修改 · 2026.10")
    pages.append(s03)

    def s04(d, idx, total):
        y = header(d, "04", "她能改自己什么")
        y = para(d, y, "这是这套系统里最不一样的地方：她有一批工具，专门用来改自己。", 32, MUTED)
        y += 16
        items = [
            ("人格", "persona：改自己是谁、脾气、底线", "2,191 字", BLUE),
            ("说话规矩", "speech：改怎么说话、什么时候闭嘴", "655 字", ORANGE),
            ("抽取规则", "extract：改「怎么把聊天变成记忆」", "418 字", PURPLE),
            ("调参", "tune_reply：温度、轮次、每天记多少条", "12 项", GREEN),
            ("自我评价", "self_write：改对自己的认识", "325 字", RED),
            ("情绪词表", "data_file：加词、改权重", "待建", MUTED),
        ]
        for head, note, right, color in items:
            y = row_card(d, y, head, note, right, color, 108)
        footer(d, idx, total, "记忆 × 行为 × 自我修改 · 2026.10")
    pages.append(s04)

    def s05(d, idx, total):
        y = header(d, "05", "她真的改过")
        y = para(d, y, "不是「理论上能改」，是改过。文件修改时间就是证据：", 32, MUTED)
        y += 18
        y = row_card(d, y, "data/persona.md", "人格文件，2,191 字", "今天 09:23 改过", BLUE, 112)
        y = row_card(d, y, "data/tuning.json", "12 项参数，温度/轮次/门槛", "今天 09:59 改过", ORANGE, 112)
        y = row_card(d, y, "data/speech-rules.md", "说话规矩，655 字", "昨天 23:45 改过", PURPLE, 112)
        y = row_card(d, y, "data/extract-rules.md", "抽取规则，418 字", "昨天 18:30 改过", GREEN, 112)
        y += 14
        y = para(d, y, "这些不是人替她写的，是她自己用工具写进去的。", 30, INK)
        footer(d, idx, total, "记忆 × 行为 × 自我修改 · 2026.10")
    pages.append(s05)

    def s06(d, idx, total):
        y = header(d, "06", "改完，什么时候生效？")
        y = para(d, y, "不同东西的生效速度不一样，这也是她「学得快不快」的关键。", 32, MUTED)
        y += 16
        y = row_card(d, y, "人格 / 说话规矩", "下一句话就生效", "立即", BLUE, 112)
        y = row_card(d, y, "调参（温度、轮次）", "下一次调用生效，不用重启", "立即", ORANGE, 112)
        y = row_card(d, y, "抽取规则", "下一次整理记忆时生效", "下次睡眠", PURPLE, 112)
        y = row_card(d, y, "情绪词表", "写完立刻重载", "立即", GREEN, 112)
        y = row_card(d, y, "代码", "改不了，需要人动手", "不归她", MUTED, 112)
        footer(d, idx, total, "记忆 × 行为 × 自我修改 · 2026.10")
    pages.append(s06)

    def s07(d, idx, total):
        y = header(d, "07", "自主性的三层")
        y = para(d, y, "「自主」不是一个开关，是三层叠起来的：", 32, MUTED)
        y += 18
        layers = [
            ("① 会自己动", "到点就动，不用人叫：30 秒走神、6 分钟活动、45 分钟开口", BLUE),
            ("② 会自己判断", "动了之后三选一：不做 / 说一句 / 动手 —— 96% 选了不做", ORANGE),
            ("③ 会改自己", "发现自己哪儿不对，就改人格、规矩、提示词、参数", PURPLE),
        ]
        for head, note, color in layers:
            d.rounded_rectangle([PAD, y, W - PAD, y + 168], radius=18, fill=(255, 255, 255), outline=LINE, width=2)
            d.rounded_rectangle([PAD, y, PAD + 10, y + 168], radius=5, fill=color)
            d.text((PAD + 28, y + 18), head, font=font(34, True), fill=color)
            for j, line in enumerate(wrap(d, note, font(26), W - PAD * 2 - 60)):
                d.text((PAD + 28, y + 76 + j * 38), line, font=font(26), fill=INK)
            y += 182
        footer(d, idx, total, "记忆 × 行为 × 自我修改 · 2026.10")
    pages.append(s07)

    def s08(d, idx, total):
        y = header(d, "08", "为什么「不做」比「做」重要")
        y = para(d, y, "一个只会输出的 AI 很烦；一个会忍住不说的 AI 才像有分寸。", 32, MUTED)
        y += 20
        y = bar_row(d, y, "今天走神", "想起一件事，权衡要不要做", "27 次", 1.0, BLUE)
        y = bar_row(d, y, "判断为不做", "「没什么要做的」", "26 次", 26 / 27, MUTED)
        y = bar_row(d, y, "真正开口", "主动找你说一句", "1 次", 1 / 27, ORANGE)
        y += 16
        y = para(d, y, "忍住的成本是思考，不是沉默。这个判断是她自己做的，不是别人替她定的规矩。", 30, INK)
        footer(d, idx, total, "记忆 × 行为 × 自我修改 · 2026.10")
    pages.append(s08)

    def s09(d, idx, total):
        y = header(d, "09", "她能改的，和她改不了的")
        y = para(d, y, "边界划清楚了，自主才安全。", 32, MUTED)
        y += 16
        can = ["人格、语气、说话规矩", "抽取规则、情绪词表", "温度、轮次、每天记多少", "自己的笔记、计划、印象", "记忆本身（改错、删错、补细节）"]
        cannot = ["代码（只能看源码，不能改）", "密钥、账号配置", "额度和安全闸", "删别人记忆（只能删自己的）"]
        d.text((PAD, y), "✅ 能改", font=font(32, True), fill=GREEN)
        y += 56
        for c in can:
            y = para(d, y, "· " + c, 26, INK, 40)
        y += 24
        d.text((PAD, y), "⛔ 改不了", font=font(32, True), fill=RED)
        y += 56
        for c in cannot:
            y = para(d, y, "· " + c, 26, MUTED, 40)
        footer(d, idx, total, "记忆 × 行为 × 自我修改 · 2026.10")
    pages.append(s09)

    def s10(d, idx, total):
        y = header(d, "10", "所以「她」是自己长出来的")
        y = para(d, y, "人不需要每一步都被人设计：给定记忆、行为和改自己的能力，她自己会收敛出一个样子。", 32, MUTED)
        y += 20
        y = bullets(d, y, [
            ("她的脾气", "不是写在代码里，是写在 persona.md 里，她可以改"),
            ("她的分寸", "不是硬编码的礼貌，是她判断过 26 次「不说」练出来的"),
            ("她的记性", "不是全记住，是知道什么该留、什么该变模糊"),
        ], gap=26)
        y += 10
        y = callout(d, y, "3 个文件", "persona / speech-rules / extract-rules —— 加起来 3,264 字，都是她自己的", PURPLE)
        footer(d, idx, total, "记忆 × 行为 × 自我修改 · 2026.10")
    pages.append(s10)

    def s11(d, idx, total):
        y = header(d, "11", "全套体检")
        items = [
            ("2,143 条记忆", "3.7 天细节 / 12.6 天梗概 / 3.8 年骨架", BLUE),
            ("12,292 条边", "关系网，有上限有半衰期", ORANGE),
            ("74 个工具", "看世界 18 / 记事情 22 / 说话 3 / 改自己 12", PURPLE),
            ("27 次走神", "今天，其中 1 次说出口", GREEN),
            ("3 个可改文件", "3,264 字，都是她自己写的", RED),
            ("50 元/天", "额度封顶，今天用掉 1.5 元", MUTED),
        ]
        for name, note, color in items:
            d.rounded_rectangle([PAD, y, W - PAD, y + 118], radius=16, fill=(255, 255, 255), outline=LINE, width=2)
            d.rounded_rectangle([PAD, y, PAD + 10, y + 118], radius=5, fill=color)
            d.text((PAD + 28, y + 16), name, font=font(30, True), fill=INK)
            for j, line in enumerate(wrap(d, note, font(23), W - PAD * 2 - 60)):
                d.text((PAD + 28, y + 64 + j * 30), line, font=font(23), fill=MUTED)
            y += 130
        footer(d, idx, total, "记忆 × 行为 × 自我修改 · 2026.10")
    pages.append(s11)

    def end(d, idx, total):
        end_page(
            d, "一句话",
            ["记忆决定她", "知道什么，", "改自己决定她", "成为谁。"],
            "前者让她有过去，后者让她有未来。",
            "而这两件事，都不需要人每一步都替她做。",
            "记忆 × 行为 × 自我修改 · 2026.10", idx, total,
        )
    pages.append(end)
    return pages


def render(pages, outdir, brand):
    os.makedirs(outdir, exist_ok=True)
    total = len(pages)
    for i, fn in enumerate(pages, start=1):
        img, d = new_page()
        fn(d, i, total)
        img.save(os.path.join(outdir, f"{i:02d}.png"))
    print(f"{outdir} -> {total} 页")


bh = behavior_pages()
render(bh, OUT_BEHAVIOR, "行为逻辑 · 2026.10")
al = all_pages()
render(al, OUT_ALL, "记忆 × 行为 × 自我修改 · 2026.10")
