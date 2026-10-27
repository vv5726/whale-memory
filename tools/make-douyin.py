# -*- coding: utf-8 -*-
"""把报告排成抖音图文：1080x1440 竖版，一页一个小节。"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = r"C:\Users\Administrator\Documents\deepseek-harness\default-workspace\whale-memory"
CHART = os.path.join(ROOT, "docs", "report")
OUT = os.path.join(ROOT, "docs", "douyin")
os.makedirs(OUT, exist_ok=True)

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
            else:
                out.append(cur)
                cur = ch
        out.append(cur)
    return out

def footer(d, idx, total, brand="记忆体系 · 2026.10"):
    d.line([(PAD, H - 96), (W - PAD, H - 96)], fill=LINE, width=2)
    d.text((PAD, H - 74), brand, font=font(24), fill=MUTED)
    t = f"{idx}/{total}"
    d.text((W - PAD - d.textlength(t, font=font(24)), H - 74), t, font=font(24), fill=MUTED)

def header(d, no, title, accent=BLUE):
    y = PAD + 10
    bw = 96
    d.rounded_rectangle([PAD, y, PAD + bw, y + 62], radius=16, fill=accent)
    d.text((PAD + 20, y + 8), no, font=font(38, True), fill=(255, 255, 255))
    ty = y + 96
    for line in wrap(d, title, font(62, True), W - PAD * 2):
        d.text((PAD, ty), line, font=font(62, True), fill=INK)
        ty += 82
    d.line([(PAD, ty + 14), (PAD + 120, ty + 14)], fill=accent, width=6)
    return ty + 56

def bullets(d, y, items, fnt_sz=38, gap=26, accent=BLUE, sub_sz=30):
    fnt = font(fnt_sz)
    sub = font(sub_sz)
    for it in items:
        if isinstance(it, tuple):
            head, body = it
        else:
            head, body = it, ""
        d.ellipse([PAD, y + 14, PAD + 14, y + 28], fill=accent)
        for i, line in enumerate(wrap(d, head, fnt, W - PAD * 2 - 40)):
            d.text((PAD + 38, y), line, font=fnt, fill=INK)
            y += int(fnt_sz * 1.5)
        if body:
            for line in wrap(d, body, sub, W - PAD * 2 - 40):
                d.text((PAD + 38, y), line, font=sub, fill=MUTED)
                y += int(sub_sz * 1.5)
        y += gap
    return y

def bar_row(d, y, label, note, value, frac, color, width=None):
    width = width or (W - PAD * 2)
    d.text((PAD, y), label, font=font(32, True), fill=INK)
    tw = d.textlength(value, font=font(34, True))
    d.text((PAD + width - tw, y - 2), value, font=font(34, True), fill=color)
    ty = y + 52
    d.rounded_rectangle([PAD, ty, PAD + width, ty + 22], radius=11, fill=(238, 241, 246))
    fw = max(24, int(width * frac))
    d.rounded_rectangle([PAD, ty, PAD + fw, ty + 22], radius=11, fill=color)
    if note:
        d.text((PAD, ty + 38), note, font=font(26), fill=MUTED)
        return ty + 38 + 46
    return ty + 60


def callout(d, y, big, label, color):
    d.rounded_rectangle([PAD, y, W - PAD, y + 190], radius=20, fill=(255, 255, 255), outline=LINE, width=2)
    d.rounded_rectangle([PAD, y, PAD + 12, y + 190], radius=6, fill=color)
    d.text((PAD + 34, y + 30), big, font=font(64, True), fill=color)
    for j, line in enumerate(wrap(d, label, font(30), W - PAD * 2 - 60)):
        d.text((PAD + 34, y + 116 + j * 42), line, font=font(30), fill=INK)
    return y + 210

PAGES = []

def page(fn):
    PAGES.append(fn)
    return fn

# ---------------- 封面 ----------------
@page
def cover(img, d, idx, total):
    d.text((PAD, PAD + 20), "凝的记忆", font=font(30, True), fill=BLUE)
    y = PAD + 150
    for line in ["这套记忆", "为什么能记很久"]:
        d.text((PAD, y), line, font=font(96, True), fill=INK)
        y += 124
    y += 26
    for line in wrap(d, "三层降级 · 原文兜底 · 关系网限流", font(38), W - PAD * 2):
        d.text((PAD, y), line, font=font(38), fill=MUTED)
        y += 58
    y += 66
    cards = [("3.7 天", "能想起细节", BLUE), ("12.6 天", "记得有这件事", ORANGE), ("3.8 年", "只剩感受片段", PURPLE), ("永久", "原文全在", GREEN)]
    cw, gap = (W - PAD * 2 - 3 * 16) // 4, 16
    for i, (big, small, color) in enumerate(cards):
        x = PAD + i * (cw + gap)
        d.rounded_rectangle([x, y, x + cw, y + 168], radius=18, fill=(255, 255, 255), outline=LINE, width=2)
        d.text((x + 18, y + 24), big, font=font(40, True), fill=color)
        for j, line in enumerate(wrap(d, small, font(22), cw - 36)):
            d.text((x + 18, y + 92 + j * 30), line, font=font(22), fill=MUTED)
    y += 232
    for line in wrap(d, "一条记忆会越来越模糊，但不会消失。", font(36), W - PAD * 2):
        d.text((PAD, y), line, font=font(36), fill=INK)
        y += 54
    y += 24
    d.text((PAD, y), "12 页 · 左滑看完整逻辑", font=font(28), fill=MUTED)
    # 底部三层金字塔（把空白填上，也把核心结构图先亮出来）
    py = 996
    layers = [("第一层 detailed", 0.68, BLUE, "113 token"), ("第二层 compressed", 0.5, ORANGE, "55"), ("第三层 fossil", 0.3, PURPLE, "40")]
    for name, frac, color, val in layers:
        w = int((W - PAD * 2) * frac)
        x = (W - w) // 2
        d.rounded_rectangle([x, py, x + w, py + 72], radius=14, fill=color)
        d.text((x + 22, py + 10), name, font=font(26, True), fill=(255, 255, 255))
        d.text((x + w - 22 - d.textlength(val, font=font(26, True)), py + 34), val, font=font(26, True), fill=(255, 255, 255))
        py += 86
    footer(d, idx, total)

# ---------------- 01 ----------------
@page
def s01(img, d, idx, total):
    y = header(d, "01", "不是存不下，是\n有意识地变模糊")
    for line in wrap(d, "每往下一层就掉一层皮，体积掉一截，条数一条不少。", font(34), W - PAD * 2):
        d.text((PAD, y), line, font=font(34), fill=MUTED)
        y += 48
    y += 26
    y = bar_row(d, y, "第一层 detailed", "标题 + 正文 + 前因后果 + 感受（全都在）", "113", 1.0, BLUE)
    y = bar_row(d, y, "第二层 compressed", "丢掉正文 → 只剩标题、片段、感受", "55", 55 / 113, ORANGE)
    y = bar_row(d, y, "第三层 fossil", "再丢前因后果 → 只剩感受和一个画面", "40", 40 / 113, PURPLE)
    y += 6
    callout(d, y, "÷ 2.8", "同一条记忆走完三层，只占原来的三分之一", BLUE)
    footer(d, idx, total)

# ---------------- 02 ----------------
@page
def s02(img, d, idx, total):
    y = header(d, "02", "三层各留什么")
    rows = [
        ("第一层 detailed", "全都在", "113 token", BLUE),
        ("第二层 compressed", "丢正文", "55 token", ORANGE),
        ("第三层 fossil", "丢前因后果", "40 token", PURPLE),
        ("底片 cold_archive", "原文全文", "永久", GREEN),
    ]
    for name, keep, size, color in rows:
        d.rounded_rectangle([PAD, y, W - PAD, y + 132], radius=18, fill=(255, 255, 255), outline=LINE, width=2)
        d.rounded_rectangle([PAD, y, PAD + 10, y + 132], radius=6, fill=color)
        d.text((PAD + 32, y + 20), name, font=font(34, True), fill=INK)
        d.text((PAD + 32, y + 76), keep, font=font(28), fill=MUTED)
        d.text((W - PAD - 32 - d.textlength(size, font=font(34, True)), y + 44), size, font=font(34, True), fill=color)
        y += 148
    y += 14
    for line in wrap(d, "第一层 2,648 条 · 第二层 9,035 条 · 第三层 1,000,000 条", font(30), W - PAD * 2):
        d.text((PAD, y), line, font=font(30), fill=MUTED)
        y += 44
    footer(d, idx, total)

# ---------------- 03 ----------------
@page
def s03(img, d, idx, total):
    y = header(d, "03", "为什么越往下越便宜")
    y = bullets(d, y, [
        ("① 正文最贵，最先丢", "113 → 55 token，一下省一半，「有这件事」还在"),
        ("② 前因后果第二贵", "55 → 40 token，再省 27%，剩下的正好是回忆很久以前的样子"),
    ], gap=16)
    y += 10
    d.rounded_rectangle([PAD, y, W - PAD, y + 300], radius=18, fill=(244, 248, 255), outline=(210, 224, 255), width=2)
    d.text((PAD + 28, y + 24), "同样的 1,000,000 token", font=font(30, True), fill=BLUE)
    d.text((PAD + 28, y + 80), "全按第一层存 → 8,849 条（12 天）", font=font(34), fill=INK)
    d.text((PAD + 28, y + 140), "三层摊开 → 101 万条（3.9 年）", font=font(34), fill=INK)
    d.text((PAD + 28, y + 210), "差 114 倍", font=font(48, True), fill=BLUE)
    footer(d, idx, total)

# ---------------- 04 ----------------
@page
def s04(img, d, idx, total):
    y = header(d, "04", "不会爆：预算只花在\n活跃的部分")
    y = bullets(d, y, [
        ("1,000,000 token", "第一层 30%，第二层 50%"),
        ("第三层不占上下文", "它进不了提示词，只封 100 万条（≈0.9 GB）"),
        ("每次对话实际约 4,200 token", "记忆块另有 1,200 token 上限"),
    ], gap=16)
    y += 10
    callout(d, y, "0.4%", "对话用掉的上下文，只占预算的千分之四", BLUE)
    y += 210
    for line in wrap(d, "池子大小决定「能想多细」，进料速度决定「多久填满一层」。", font(30), W - PAD * 2):
        d.text((PAD, y), line, font=font(30), fill=MUTED)
        y += 44
    footer(d, idx, total)

# ---------------- 05 ----------------
@page
def s05(img, d, idx, total):
    y = header(d, "05", "关系网也不会\n无限涨")
    for line in wrap(d, "「同一天出现过」的边是 n×(n-1)/2 条：一天 100 个锚点就是 5,000 条，三天灌到 4 万。", font(30), W - PAD * 2):
        d.text((PAD, y), line, font=font(30), fill=MUTED)
        y += 44
    y += 20
    y = bar_row(d, y, "热边：还挂着第一层记忆", "不设上限", "15 天", 1.0, BLUE)
    y = bar_row(d, y, "温边：只剩第二层", "超 20,000 砍到一半", "3 天", 3 / 15, ORANGE)
    y = bar_row(d, y, "冷边：只剩第三层", "超 2,000 砍到一半", "2 天", 2 / 15, PURPLE)
    y += 8
    callout(d, y, "27,807", "实测删掉这么多温边，7 个查询召回一条没少", GREEN)
    footer(d, idx, total)

# ---------------- 06 ----------------
@page
def s06(img, d, idx, total):
    y = header(d, "06", "原文永远不会丢")
    y = bullets(d, y, [
        ("压之前先写进 cold_archive", "全文照抄，留一个 cold:// 地址"),
        ("平时不读 → 不占 token", "真需要时按地址取回，一字不少"),
        ("关键词撞上了还会被唤醒", "「记不清细节」不等于「找不回来」"),
    ], gap=20)
    y += 10
    callout(d, y, "1,600 条", "底片里已经有这么多原文，共 16.7 万字", GREEN)
    footer(d, idx, total)

# ---------------- 07 ----------------
@page
def s07(img, d, idx, total):
    y = header(d, "07", "磁盘账：一年 226 MB")
    y = bullets(d, y, [
        ("每条 0.9 KB × 714 条/天", "化石行 0.6 KB + 底片原文 0.3 KB"),
        ("越省的是「正文」，不是「条数」", "所以条数一直涨，体积涨得慢"),
    ], gap=18)
    y += 10
    y = bar_row(d, y, "现在已经用了", "库文件 7.3 MB", "7 MB", 7 / 1024, BLUE)
    y = bar_row(d, y, "一年之后", "约 226 MB", "226 MB", 226 / 1024, ORANGE)
    y = bar_row(d, y, "自我上限 1 GB", "约 4.5 年才碰到", "1 GB", 1.0, PURPLE)
    footer(d, idx, total)

# ---------------- 08 ----------------
@page
def s08(img, d, idx, total):
    y = header(d, "08", "现在的体检数字")
    items = [
        ("2,143 条记忆", "第一层 553 / 第二层 1,590 / 第三层 0"),
        ("473 个锚点", "人的 QQ、事、场景、话题"),
        ("12,292 条边", "热 1,785 / 温 9,269 / 冷 1,102"),
        ("1,600 条底片", "原文共 16.7 万字"),
        ("2,874 条对话", "每次只取最近 50 条进提示词"),
        ("7.3 MB 库", "VACUUM 之后"),
    ]
    for name, note in items:
        d.rounded_rectangle([PAD, y, W - PAD, y + 118], radius=16, fill=(255, 255, 255), outline=LINE, width=2)
        d.text((PAD + 28, y + 18), name, font=font(34, True), fill=INK)
        d.text((PAD + 28, y + 66), note, font=font(26), fill=MUTED)
        y += 130
    footer(d, idx, total)

# ---------------- 09 ----------------
@page
def s09(img, d, idx, total):
    y = header(d, "09", "代价：它是故意\n变模糊的")
    y = bullets(d, y, [
        ("3.7 天以后", "能说清「有这件事」，不能再复述原话"),
        ("16 天以后", "只剩「那次挺难受的，好像跟钱有关」"),
        ("要细节", "翻底片地址，或等关键词把它唤醒"),
    ], gap=20)
    y += 10
    for line in wrap(d, "这不是 bug，是设计：用逐渐变粗的记忆，换一个几乎不会爆的上限。", font(32), W - PAD * 2):
        d.text((PAD, y), line, font=font(32), fill=INK)
        y += 50
    footer(d, idx, total)

# ---------------- 10 ----------------
@page
def s10(img, d, idx, total):
    y = header(d, "10", "想调就调")
    rows = [
        ("记忆总共能装多少", "contextBudgetTokens", "1,000,000"),
        ("第一层留多少", "detailedQuota", "30%"),
        ("第三层封顶", "FOSSIL_MAX_EVENTS", "100 万条"),
        ("每天记多少条", "v3MinValue / v3MaxEvents", "2 / 12"),
        ("边三档半衰期", "hotDays / warmDays / coldDays", "15 / 3 / 2"),
        ("边上限", "warmCap / coldCap", "20,000 / 2,000"),
    ]
    for name, key, val in rows:
        d.line([(PAD, y + 120), (W - PAD, y + 120)], fill=LINE, width=2)
        d.text((PAD, y + 16), name, font=font(34, True), fill=INK)
        d.text((PAD, y + 66), key, font=font(24), fill=MUTED)
        d.text((W - PAD - d.textlength(val, font=font(34, True)), y + 16), val, font=font(34, True), fill=BLUE)
        y += 124
    footer(d, idx, total)

# ---------------- 结尾 ----------------
@page
def end(img, d, idx, total):
    d.text((PAD, 330), "一句话", font=font(30, True), fill=BLUE)
    y = 424
    for line in ["它记不住细节，", "但它几乎不会忘掉", "「发生过什么」。"]:
        d.text((PAD, y), line, font=font(72, True), fill=INK)
        y += 104
    y += 44
    for line in wrap(d, "3.7 天的细节，3.9 年的骨架，和一个永远不丢的原文地址。", font(34), W - PAD * 2):
        d.text((PAD, y), line, font=font(34), fill=MUTED)
        y += 54
    y += 40
    d.line([(PAD, y), (PAD + 120, y)], fill=BLUE, width=6)
    y += 34
    for line in wrap(d, "这不是压缩算法，是允许自己忘得越来越粗——换一个几乎不会爆的上限。", font(30), W - PAD * 2):
        d.text((PAD, y), line, font=font(30), fill=INK)
        y += 46
    footer(d, idx, total)

total = len(PAGES)
for i, fn in enumerate(PAGES, start=1):
    img, d = new_page()
    fn(img, d, i, total)
    path = os.path.join(OUT, f"{i:02d}.png")
    img.save(path)
    print("saved", path)

print("pages:", total)
