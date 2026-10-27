# -*- coding: utf-8 -*-
"""抖音图文：记忆架构是怎么搭的（1080x1440，一页一个概念）。"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = r"C:\Users\Administrator\Documents\deepseek-harness\default-workspace\whale-memory"
OUT = os.path.join(ROOT, "docs", "douyin-arch")
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
RED = (200, 60, 60)
SOFT = (244, 248, 255)

def new_page():
    img = Image.new("RGB", (W, H), BG)
    return img, ImageDraw.Draw(img)

PUNCT = "。，、；：？！）」』…"

def wrap(d, text, fnt, max_w):
    out = []
    for para in str(text).split("\n"):
        cur = ""
        for ch in para:
            if d.textlength(cur + ch, font=fnt) <= max_w:
                cur += ch
            elif ch in PUNCT and cur:
                cur += ch  # 标点跟着这一行走，别单独掉到下一行开头
            else:
                out.append(cur)
                cur = ch
        out.append(cur)
    return out

def footer(d, idx, total, brand="记忆架构 · 2026.10"):
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

def para(d, y, text, sz=34, color=None, gap=48):
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
            y += int(sz * 1.5)
        if body:
            for line in wrap(d, body, sub, W - PAD * 2 - 40):
                d.text((PAD + 38, y), line, font=sub, fill=MUTED)
                y += int(sub_sz * 1.5)
        y += gap
    return y

def callout(d, y, big, label, color, h=190):
    d.rounded_rectangle([PAD, y, W - PAD, y + h], radius=20, fill=(255, 255, 255), outline=LINE, width=2)
    d.rounded_rectangle([PAD, y, PAD + 12, y + h], radius=6, fill=color)
    d.text((PAD + 34, y + 28), big, font=font(62, True), fill=color)
    for j, line in enumerate(wrap(d, label, font(30), W - PAD * 2 - 60)):
        d.text((PAD + 34, y + 112 + j * 42), line, font=font(30), fill=INK)
    return y + h + 20

def card(d, x, y, w, h, color, alpha_fill=None):
    d.rounded_rectangle([x, y, x + w, y + h], radius=16, fill=alpha_fill or (255, 255, 255), outline=LINE, width=2)
    d.rounded_rectangle([x, y, x + 10, y + h], radius=5, fill=color)

PAGES = []
def page(fn):
    PAGES.append(fn)
    return fn

# ---------- 封面 ----------
@page
def cover(img, d, idx, total):
    d.text((PAD, PAD + 20), "记忆架构", font=font(30, True), fill=BLUE)
    y = PAD + 150
    for line in ["一套 AI 记忆", "是怎么搭起来的"]:
        d.text((PAD, y), line, font=font(92, True), fill=INK)
        y += 122
    y += 24
    for line in wrap(d, "从一句「早安」到三年后还记得", font(38), W - PAD * 2):
        d.text((PAD, y), line, font=font(38), fill=MUTED)
        y += 58
    y += 60
    cards = [("7 步", "一条链路", BLUE), ("2,143 条", "记忆", ORANGE), ("473 个", "锚点", PURPLE), ("12,292 条", "关系边", GREEN)]
    cw, gap = (W - PAD * 2 - 3 * 16) // 4, 16
    for i, (big, small, color) in enumerate(cards):
        x = PAD + i * (cw + gap)
        d.rounded_rectangle([x, y, x + cw, y + 160], radius=18, fill=(255, 255, 255), outline=LINE, width=2)
        d.text((x + 16, y + 22), big, font=font(36, True), fill=color)
        for j, line in enumerate(wrap(d, small, font(22), cw - 32)):
            d.text((x + 16, y + 88 + j * 28), line, font=font(22), fill=MUTED)
    # 中间说明
    y = 830
    for line in wrap(d, "先存原话，再拆成「事」，挂到人和场景上，连成网，最后按相关度被想起来。", font(32), W - PAD * 2):
        d.text((PAD, y), line, font=font(32), fill=INK)
        y += 48
    # 底部流程条
    y = 990
    steps = ["聊天", "抽取", "记忆", "锚点", "关系", "回忆"]
    sw = (W - PAD * 2 - 5 * 12) // 6
    for i, s in enumerate(steps):
        x = PAD + i * (sw + 12)
        d.rounded_rectangle([x, y, x + sw, y + 78], radius=14, fill=SOFT, outline=(210, 224, 255), width=2)
        tw = d.textlength(s, font=font(26, True))
        d.text((x + (sw - tw) / 2, y + 24), s, font=font(26, True), fill=BLUE)
        if i < len(steps) - 1:
            d.text((x + sw + 2, y + 22), "›", font=font(34, True), fill=(180, 190, 205))
    footer(d, idx, total)

# ---------- 01 总览 ----------
@page
def s01(img, d, idx, total):
    y = header(d, "01", "七个步骤，一条链路")
    y = para(d, y, "每一句聊天都会走同一条路：先存原话，再拆成「事」，挂到人和场景上，连成网，最后按相关度被想起来。", 32, MUTED)
    y += 16
    steps = [
        ("① 存原话", "turns：谁、在哪、什么时候、说了什么", BLUE),
        ("② 抽成事", "一句话拆成一条「记忆」：主体+经过+因果", ORANGE),
        ("③ 挂锚点", "这条事跟谁、哪个场景、哪个话题有关", PURPLE),
        ("④ 连关系", "同一天出现的锚点之间连边", GREEN),
        ("⑤ 打分召回", "证据、锚点、情绪、强度加权排序", BLUE),
        ("⑥ 拼上下文", "只把最相关的几条塞给模型", ORANGE),
        ("⑦ 睡觉整理", "压缩、合并、算情绪、淘汰弱边", PURPLE),
    ]
    for head, note, color in steps:
        card(d, PAD, y, W - PAD * 2, 118, color)
        d.text((PAD + 28, y + 16), head, font=font(32, True), fill=INK)
        d.text((PAD + 28, y + 66), note, font=font(26), fill=MUTED)
        y += 130
    footer(d, idx, total)

# ---------- 02 原话 ----------
@page
def s02(img, d, idx, total):
    y = header(d, "02", "第一步：先把原话存下来")
    y = para(d, y, "抽取可能出错，模型也可能改主意。原话是唯一能回退的东西。", 32, MUTED)
    y += 20
    rows = [
        ("他", "早安 小凝子", "私聊 · 09:12", BLUE),
        ("阿牙易", "你今天状态好点没", "群 20001 · 09:20", ORANGE),
        ("凝", "好多了，昨天那事想明白了", "回复", PURPLE),
    ]
    for who, text, tag, color in rows:
        h = 150
        d.rounded_rectangle([PAD, y, W - PAD, y + h], radius=18, fill=(255, 255, 255), outline=LINE, width=2)
        d.rounded_rectangle([PAD + 24, y + 24, PAD + 90, y + 90], radius=14, fill=color)
        tw = d.textlength(who[:1], font=font(30, True))
        d.text((PAD + 57 - tw / 2, y + 38), who[:1], font=font(30, True), fill=(255, 255, 255))
        d.text((PAD + 108, y + 26), who, font=font(28, True), fill=INK)
        d.text((PAD + 108, y + 68), tag, font=font(24), fill=MUTED)
        for j, line in enumerate(wrap(d, text, font(30), W - PAD * 2 - 130)):
            d.text((PAD + 108, y + 100 + j * 38), line, font=font(30), fill=INK)
        y += h + 16
    y += 16
    y = para(d, y, "每条都带：说话人、会话（群号/私聊）、时间、原始文本。现在库里 2,874 条。", 30, INK)
    footer(d, idx, total)

# ---------- 03 抽取 ----------
@page
def s03(img, d, idx, total):
    y = header(d, "03", "第二步：把对话拆成「一件事」")
    y = para(d, y, "不是写总结，是把一段聊天里的每件事单独拎出来。跨好几条消息说的一件事，要合成一条。", 32, MUTED)
    y += 20
    d.rounded_rectangle([PAD, y, W - PAD, y + 300], radius=18, fill=SOFT, outline=(210, 224, 255), width=2)
    d.text((PAD + 26, y + 20), "原始对话", font=font(26, True), fill=BLUE)
    raw = ["A：周六有空吗", "B：有啊干嘛", "A：去不去露营", "B：行，下午三点?"]
    yy = y + 62
    for line in raw:
        d.text((PAD + 26, yy), line, font=font(26), fill=INK)
        yy += 40
    d.text((PAD + 26, y + 232), "↓", font=font(40, True), fill=BLUE)
    y += 320
    d.rounded_rectangle([PAD, y, W - PAD, y + 150], radius=18, fill=(255, 255, 255), outline=LINE, width=2)
    d.rounded_rectangle([PAD, y, PAD + 10, y + 150], radius=5, fill=ORANGE)
    d.text((PAD + 26, y + 18), "一条记忆", font=font(26, True), fill=ORANGE)
    d.text((PAD + 26, y + 58), "A 和 B 约定周六下午三点去露营", font=font(32, True), fill=INK)
    d.text((PAD + 26, y + 108), "类型=约定 · 状态=待确认 · 证据=［B：行，下午三点?］", font=font(24), fill=MUTED)
    y += 170
    y = para(d, y, "每天这样抽出 714 条（最近三天实测）。", 30, MUTED)
    footer(d, idx, total)

# ---------- 04 一条记忆的解剖 ----------
@page
def s04(img, d, idx, total):
    y = header(d, "04", "一条记忆长什么样")
    y = para(d, y, "不是一段话，是八个字段。少一个，以后就少一条能想起来的线索。", 32, MUTED)
    y += 16
    fields = [
        ("标题 title", "一句话说清这件事", BLUE),
        ("正文 detail", "发生了什么", BLUE),
        ("前因 cause", "为什么会这样", ORANGE),
        ("后果 effect", "后来怎么样了", ORANGE),
        ("感受 affect", "我当时什么情绪、多强", PURPLE),
        ("关键事实 key_facts", "数字、时间、地点、名字", GREEN),
        ("证据 evidence", "原话是哪条消息（可回查）", MUTED),
        ("强度 strength", "被反复提起就变高", RED),
    ]
    for name, note, color in fields:
        d.rounded_rectangle([PAD, y, W - PAD, y + 96], radius=14, fill=(255, 255, 255), outline=LINE, width=2)
        d.rounded_rectangle([PAD, y, PAD + 8, y + 96], radius=4, fill=color)
        d.text((PAD + 26, y + 12), name, font=font(28, True), fill=INK)
        d.text((PAD + 26, y + 52), note, font=font(24), fill=MUTED)
        y += 106
    footer(d, idx, total)

# ---------- 05 锚点 ----------
@page
def s05(img, d, idx, total):
    y = header(d, "05", "第三步：挂到锚点上")
    y = para(d, y, "锚点就是「提到的东西」：人、事、场景、话题。一条记忆可以挂好几个，这样从任何一个角度都能找到它。", 32, MUTED)
    y += 10
    cx, cy = W // 2, y + 210
    nodes = [("人：阿牙易", -1, -1, ORANGE), ("事：露营", 1, -1, PURPLE), ("场景：那个群", -1, 1, GREEN), ("话题：计划表", 1, 1, RED)]
    # 先画连线，再画节点，线就不会压在方块上
    for label, dx, dy, color in nodes:
        d.line([(cx, cy), (cx + dx * 330, cy + dy * 150)], fill=(190, 200, 215), width=3)
    d.rounded_rectangle([cx - 150, cy - 56, cx + 150, cy + 56], radius=18, fill=BLUE)
    d.text((cx - 96, cy - 22), "一条记忆", font=font(30, True), fill=(255, 255, 255))
    for label, dx, dy, color in nodes:
        nx, ny = cx + dx * 330, cy + dy * 150
        w = 250 if len(label) > 5 else 210
        d.rounded_rectangle([nx - w // 2, ny - 34, nx + w // 2, ny + 34], radius=14, fill=(255, 255, 255), outline=color, width=3)
        tw = d.textlength(label, font=font(24, True))
        d.text((nx - tw / 2, ny - 16), label, font=font(24, True), fill=color)
    y = cy + 200
    y = para(d, y, "现在库里有 473 个锚点。", 30, INK)
    y = para(d, y, "挂错锚点的代价：以后从那个角度就找不到它了。", 28, MUTED, 42)
    footer(d, idx, total)

# ---------- 06 关系网 ----------
@page
def s06(img, d, idx, total):
    y = header(d, "06", "第四步：连成关系网")
    y = para(d, y, "同一天出现过的锚点会两两连一条弱边。它让「升职那天我妈哭了」能从「升职」走到「我妈」。", 32, MUTED)
    y += 20
    cx, cy = W // 2, y + 200
    pts = [("升职", 0, 0, BLUE), ("我妈", -260, -120, ORANGE), ("那天聚餐", 240, -130, PURPLE), ("老板", -230, 130, GREEN), ("那瓶酒", 250, 120, RED)]
    for i in range(1, len(pts)):
        d.line([(cx + pts[0][1], cy + pts[0][2]), (cx + pts[i][1], cy + pts[i][2])], fill=(190, 200, 215), width=3)
    d.line([(cx - 260, cy - 120), (cx - 230, cy + 130)], fill=(214, 220, 232), width=2)
    d.line([(cx + 250, cy + 120), (cx + 240, cy - 130)], fill=(214, 220, 232), width=2)
    for label, dx, dy, color in pts:
        d.ellipse([cx + dx - 62, cy + dy - 62, cx + dx + 62, cy + dy + 62], fill=(255, 255, 255), outline=color, width=4)
        tw = d.textlength(label, font=font(22, True))
        d.text((cx + dx - tw / 2, cy + dy - 14), label, font=font(22, True), fill=color)
    y = cy + 200
    y = para(d, y, "现在 12,292 条边：热 1,785 / 温 9,269 / 冷 1,102。", 30, INK)
    y = para(d, y, "不设上限就会爆——所以它有半衰期和上限。", 28, MUTED, 42)
    footer(d, idx, total)

# ---------- 07 召回 ----------
@page
def s07(img, d, idx, total):
    y = header(d, "07", "第五步：不是全塞，是打分挑")
    y = para(d, y, "她不可能把所有记忆都读一遍。每次说话前，按四个信号给记忆打分，只取最相关的那几条。", 32, MUTED)
    y += 20
    rows = [
        ("证据对得上", "原话里有这次说的词", 0.95, BLUE),
        ("锚点对上号", "提到的人和事命中", 0.82, ORANGE),
        ("情绪有分量", "当时情绪越强越容易被想起", 0.66, PURPLE),
        ("被反复提起", "强度越高越靠前", 0.54, GREEN),
    ]
    for name, note, frac, color in rows:
        d.text((PAD, y), name, font=font(30, True), fill=INK)
        d.text((PAD, y + 40), note, font=font(24), fill=MUTED)
        ty = y + 84
        d.rounded_rectangle([PAD, ty, W - PAD, ty + 18], radius=9, fill=(238, 241, 246))
        d.rounded_rectangle([PAD, ty, PAD + int((W - PAD * 2) * frac), ty + 18], radius=9, fill=color)
        y += 132
    y += 8
    callout(d, y, "1,200 token", "最后给她的记忆块有硬上限：超了按分数从低到高丢", BLUE)
    footer(d, idx, total)

# ---------- 08 拼上下文 ----------
@page
def s08(img, d, idx, total):
    y = header(d, "08", "第六步：拼成「五摞纸」")
    y = para(d, y, "模型看不见数据库，只能看见这一叠纸。纸里没有的，她就不知道。", 32, MUTED)
    y += 16
    stacks = [
        ("① 她是谁", "人格、底线、说话规矩", 1600, BLUE),
        ("② 这是哪儿、跟谁", "群号、在场的人、谁是谁", 700, ORANGE),
        ("③ 想起的事", "上一步挑出的记忆", 400, PURPLE),
        ("④ 手上有什么工具", "74 个工具的名字", 730, GREEN),
        ("⑤ 刚才聊了什么", "这个会话最近 50 条", 700, MUTED),
    ]
    for name, note, size, color in stacks:
        d.rounded_rectangle([PAD, y, W - PAD, y + 112], radius=14, fill=(255, 255, 255), outline=LINE, width=2)
        d.rounded_rectangle([PAD, y, PAD + 8, y + 112], radius=4, fill=color)
        d.text((PAD + 26, y + 14), name, font=font(30, True), fill=INK)
        d.text((PAD + 26, y + 60), note, font=font(24), fill=MUTED)
        v = f"{size} token"
        d.text((W - PAD - 26 - d.textlength(v, font=font(26, True)), y + 40), v, font=font(26, True), fill=color)
        y += 124
    y += 10
    y = para(d, y, "合计约 4,200 token —— 一句 4 个字的「早安」，她读的是这些。", 28, INK)
    footer(d, idx, total)

# ---------- 09 睡觉整理 ----------
@page
def s09(img, d, idx, total):
    y = header(d, "09", "第七步：睡觉时整理")
    y = para(d, y, "聊完 3 分钟整理一次，每天 3–5 点整日整理。整理时干五件事：", 32, MUTED)
    y += 20
    items = [
        ("抽取", "把新对话变成记忆", BLUE),
        ("压缩", "装不下了就把旧的降一层", ORANGE),
        ("算情绪", "给每条记忆标上当时的感觉", PURPLE),
        ("合锚点", "同一个人不同的叫法合成一个", GREEN),
        ("衰减关系", "没用的连边慢慢变淡、消失", RED),
    ]
    for head, note, color in items:
        d.rounded_rectangle([PAD, y, W - PAD, y + 108], radius=14, fill=(255, 255, 255), outline=LINE, width=2)
        d.ellipse([PAD + 24, y + 38, PAD + 68, y + 82], fill=color)
        d.text((PAD + 92, y + 18), head, font=font(32, True), fill=INK)
        d.text((PAD + 92, y + 62), note, font=font(24), fill=MUTED)
        y += 120
    y += 10
    y = para(d, y, "这一步是「离线」的：不影响回话，但决定了她明天还记得什么。", 28, MUTED)
    footer(d, idx, total)

# ---------- 10 三层 ----------
@page
def s10(img, d, idx, total):
    y = header(d, "10", "整理的结果：三层")
    y = para(d, y, "越旧越模糊，但也越省。三层加一个底片，就是整套记忆的骨架。", 32, MUTED)
    y += 16
    layers = [
        ("第一层 detailed", "标题+正文+因果+感受", "113 token", BLUE),
        ("第二层 compressed", "丢正文", "55 token", ORANGE),
        ("第三层 fossil", "丢前因后果", "40 token", PURPLE),
        ("底片 cold_archive", "原文全文，永久保存", "0.3 KB", GREEN),
    ]
    for name, note, size, color in layers:
        d.rounded_rectangle([PAD, y, W - PAD, y + 122], radius=16, fill=(255, 255, 255), outline=LINE, width=2)
        d.rounded_rectangle([PAD, y, PAD + 10, y + 122], radius=5, fill=color)
        d.text((PAD + 28, y + 16), name, font=font(30, True), fill=INK)
        d.text((PAD + 28, y + 62), note, font=font(24), fill=MUTED)
        d.text((W - PAD - 28 - d.textlength(size, font=font(28, True)), y + 44), size, font=font(28, True), fill=color)
        y += 136
    footer(d, idx, total)

# ---------- 11 三个不变量 ----------
@page
def s11(img, d, idx, total):
    y = header(d, "11", "为什么这套结构站得住")
    y = para(d, y, "架构可以花哨，但必须有三个不能破的约束：", 32, MUTED)
    y += 20
    y = bullets(d, y, [
        ("原话永远留底", "抽取错了能回退，模型换了也能重建"),
        ("每条记忆都有证据编号", "能追到它是哪句话来的，不靠记忆自己编"),
        ("情绪跟着记忆走", "解释「为什么这件事我记得，那件不记得」"),
    ], gap=28)
    y += 6
    callout(d, y, "1 : 1", "一条记忆对应至少一条原话证据；对不上就不入库", GREEN)
    footer(d, idx, total)

# ---------- 12 体检 ----------
@page
def s12(img, d, idx, total):
    y = header(d, "12", "现在长什么样")
    items = [
        ("2,143 条记忆", "第一层 553 / 第二层 1,590 / 第三层 0"),
        ("473 个锚点", "人、事、场景、话题"),
        ("12,292 条边", "热 1,785 / 温 9,269 / 冷 1,102"),
        ("1,600 条底片", "原文共 16.7 万字"),
        ("74 个工具", "她自己能查、能改、能发消息"),
        ("7.3 MB 库", "每天新增约 714 条记忆"),
    ]
    for name, note in items:
        d.rounded_rectangle([PAD, y, W - PAD, y + 118], radius=16, fill=(255, 255, 255), outline=LINE, width=2)
        d.text((PAD + 28, y + 18), name, font=font(32, True), fill=INK)
        d.text((PAD + 28, y + 66), note, font=font(25), fill=MUTED)
        y += 130
    footer(d, idx, total)

# ---------- 结尾 ----------
@page
def end(img, d, idx, total):
    d.text((PAD, 330), "一句话", font=font(30, True), fill=BLUE)
    y = 420
    for line in ["记忆不是存得多，", "是每一层都知道", "该丢什么。"]:
        d.text((PAD, y), line, font=font(74, True), fill=INK)
        y += 104
    y += 40
    for line in wrap(d, "原话留底、证据可查、情绪可解释——剩下的，交给三层去慢慢变模糊。", font(32), W - PAD * 2):
        d.text((PAD, y), line, font=font(32), fill=MUTED)
        y += 50
    y += 30
    d.line([(PAD, y), (PAD + 120, y)], fill=BLUE, width=6)
    footer(d, idx, total)

total = len(PAGES)
for i, fn in enumerate(PAGES, start=1):
    img, d = new_page()
    fn(img, d, i, total)
    img.save(os.path.join(OUT, f"{i:02d}.png"))
print("pages:", total, "->", OUT)
