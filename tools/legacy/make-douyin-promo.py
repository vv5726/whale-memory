# -*- coding: utf-8 -*-
"""抖音宣传版：三套合一。四个主张：记得久 / 记得准 / 很自主 / 越用越聪明。"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = r"C:\Users\Administrator\Documents\deepseek-harness\default-workspace\whale-memory"
OUT = os.path.join(ROOT, "docs", "douyin-promo")

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

def footer(d, idx, total):
    d.line([(PAD, H - 96), (W - PAD, H - 96)], fill=LINE, width=2)
    d.text((PAD, H - 74), "凝 · 记忆系统 · 2026.10", font=font(24), fill=MUTED)
    t = f"{idx}/{total}"
    d.text((W - PAD - d.textlength(t, font=font(24)), H - 74), t, font=font(24), fill=MUTED)

def header(d, tag, title, accent=BLUE):
    # 标签块宽度跟着文字走：固定 120 会把「越用越聪明」挤出圆角框
    bw = max(120, int(d.textlength(tag, font=font(28, True))) + 44)
    d.rounded_rectangle([PAD, PAD + 10, PAD + bw, PAD + 62], radius=14, fill=accent)
    tw = d.textlength(tag, font=font(28, True))
    d.text((PAD + bw / 2 - tw / 2, PAD + 18), tag, font=font(28, True), fill=(255, 255, 255))
    ty = PAD + 106
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
        d.text((W - PAD - 26 - d.textlength(right, font=font(26, True)), y + 42), right, font=font(26, True), fill=color)
    return y + h + 12

def bar_row(d, y, label, note, value, frac, color):
    width = W - PAD * 2
    d.text((PAD, y), label, font=font(30, True), fill=INK)
    d.text((PAD + width - d.textlength(value, font=font(32, True)), y - 2), value, font=font(32, True), fill=color)
    ty = y + 48
    d.rounded_rectangle([PAD, ty, PAD + width, ty + 20], radius=10, fill=(238, 241, 246))
    d.rounded_rectangle([PAD, ty, PAD + max(20, int(width * frac)), ty + 20], radius=10, fill=color)
    if note:
        d.text((PAD, ty + 32), note, font=font(24), fill=MUTED)
        return ty + 32 + 40
    return ty + 54

PAGES = []
def page(fn):
    PAGES.append(fn)
    return fn

# ---------------- 封面 ----------------
@page
def cover(d, idx, total):
    d.text((PAD, PAD + 20), "一个 AI 的记忆到底该长什么样", font=font(28, True), fill=BLUE)
    y = PAD + 130
    for line in ["记得久，记得准，", "还会自己长大"]:
        d.text((PAD, y), line, font=font(90, True), fill=INK)
        y += 118
    y += 26
    y = para(d, y, "三层记忆 + 关系网 + 自己动 + 自己改 —— 我把这套东西拆开给你看。", 34, MUTED, 52)
    y += 30
    cards = [("3.7 天", "细节记得住", BLUE), ("3.9 年", "骨架不丢", ORANGE), ("27 次", "今天自己想事", PURPLE), ("3 个文件", "自己改自己", GREEN)]
    cw, gap = (W - PAD * 2 - 3 * 16) // 4, 16
    for i, (big, small, color) in enumerate(cards):
        x = PAD + i * (cw + gap)
        d.rounded_rectangle([x, y, x + cw, y + 158], radius=18, fill=(255, 255, 255), outline=LINE, width=2)
        d.text((x + 16, y + 22), big, font=font(34, True), fill=color)
        for j, line in enumerate(wrap(d, small, font(21), cw - 32)):
            d.text((x + 16, y + 86 + j * 26), line, font=font(21), fill=MUTED)
    y += 196
    steps = ["记得久", "记得准", "很自主", "越用越聪明"]
    sw = (W - PAD * 2 - 3 * 12) // 4
    for i, s in enumerate(steps):
        x = PAD + i * (sw + 12)
        d.rounded_rectangle([x, y, x + sw, y + 74], radius=14, fill=SOFT, outline=(210, 224, 255), width=2)
        tw = d.textlength(s, font=font(24, True))
        d.text((x + (sw - tw) / 2, y + 22), s, font=font(24, True), fill=BLUE)
    # 底部三层示意，把空白填上，也先亮出结构
    py = 1010
    for name, frac, color, val in [
        ("第一层 detailed", 0.66, BLUE, "113 token"),
        ("第二层 compressed", 0.48, ORANGE, "55"),
        ("第三层 fossil", 0.30, PURPLE, "40"),
    ]:
        w = int((W - PAD * 2) * frac)
        x = (W - w) // 2
        d.rounded_rectangle([x, py, x + w, py + 72], radius=14, fill=color)
        d.text((x + 22, py + 10), name, font=font(25, True), fill=(255, 255, 255))
        d.text((x + w - 22 - d.textlength(val, font=font(25, True)), py + 34), val, font=font(25, True), fill=(255, 255, 255))
        py += 86
    d.text((PAD, 1270), "18 页 · 左滑看完整逻辑", font=font(26), fill=MUTED)
    footer(d, idx, total)

# ---------------- 四个主张 ----------------
@page
def claims(d, idx, total):
    y = header(d, "总览", "四个主张，一条链")
    y = para(d, y, "不是四个功能，是一个循环：记得住 → 想得准 → 自己动 → 动了之后改自己。", 32, MUTED)
    y += 18
    items = [
        ("① 记得久", "3.7 天细节 / 12.6 天梗概 / 3.8 年骨架，原文永久", BLUE),
        ("② 记得准", "每条记忆能追到原话证据，靠锚点和情绪排序", ORANGE),
        ("③ 很自主", "30 秒走神、6 分钟活动、想到人才开口；96% 选择不说", PURPLE),
        ("④ 越用越聪明", "她改自己的提示词、规矩、参数，改完立即生效", GREEN),
    ]
    for head, note, color in items:
        d.rounded_rectangle([PAD, y, W - PAD, y + 148], radius=18, fill=(255, 255, 255), outline=LINE, width=2)
        d.rounded_rectangle([PAD, y, PAD + 10, y + 148], radius=5, fill=color)
        d.text((PAD + 28, y + 18), head, font=font(34, True), fill=color)
        for j, line in enumerate(wrap(d, note, font(26), W - PAD * 2 - 60)):
            d.text((PAD + 28, y + 78 + j * 38), line, font=font(26), fill=INK)
        y += 162
    footer(d, idx, total)

# ---------------- 一、记得久 ----------------
@page
def long_1(d, idx, total):
    y = header(d, "记得久", "三层金字塔：越旧越模糊，也越省", BLUE)
    y = para(d, y, "一条记忆往下走一层就掉一层皮，体积掉一截，但条数一条不少。", 32, MUTED)
    y += 22
    layers = [
        ("第一层 detailed", "标题+正文+因果+感受", "113 token", "2,648 条 / 3.7 天", BLUE),
        ("第二层 compressed", "丢正文，只剩骨架", "55 token", "9,035 条 / 12.6 天", ORANGE),
        ("第三层 fossil", "丢前因后果，只剩感受", "40 token", "100 万条 / 3.8 年", PURPLE),
    ]
    for name, note, size, cap, color in layers:
        d.rounded_rectangle([PAD, y, W - PAD, y + 150], radius=18, fill=(255, 255, 255), outline=LINE, width=2)
        d.rounded_rectangle([PAD, y, PAD + 10, y + 150], radius=5, fill=color)
        d.text((PAD + 28, y + 16), name, font=font(32, True), fill=INK)
        d.text((PAD + 28, y + 62), note, font=font(24), fill=MUTED)
        d.text((PAD + 28, y + 104), cap, font=font(24), fill=color)
        d.text((W - PAD - 26 - d.textlength(size, font=font(34, True)), y + 24), size, font=font(34, True), fill=color)
        y += 164
    y += 6
    y = callout(d, y, "永久", "压之前原文先写进底片（cold_archive），留 cold:// 地址，随时能翻回来", GREEN)
    footer(d, idx, total)

@page
def long_2(d, idx, total):
    y = header(d, "记得久", "为什么能撑三年：越往下越便宜", BLUE)
    y = para(d, y, "同样是 100 万 token 的地方，全按第一层存只能装 8,849 条（12 天）。三层摊开能装 101 万条。", 32, MUTED)
    y += 26
    y = bar_row(d, y, "第一层 113 token", "标题+正文+因果+感受", "113", 1.0, BLUE)
    y = bar_row(d, y, "第二层 55 token", "只丢正文，省一半", "55", 55 / 113, ORANGE)
    y = bar_row(d, y, "第三层 40 token", "再丢因果，省到三分之一", "40", 40 / 113, PURPLE)
    y += 14
    y = callout(d, y, "114 倍", "同一块地方，摊开之后能多装 114 倍的记忆 —— 这不是压缩算法，是允许自己忘得越来越粗", GREEN)
    footer(d, idx, total)

@page
def long_3(d, idx, total):
    y = header(d, "记得久", "磁盘账：一年 226 MB", BLUE)
    y = para(d, y, "每条约 0.9 KB（化石行 0.6 + 底片原文 0.3），每天进 714 条。", 32, MUTED)
    y += 26
    y = bar_row(d, y, "现在用了", "库文件 7.3 MB", "7 MB", 7 / 1024, BLUE)
    y = bar_row(d, y, "一年之后", "约 226 MB", "226 MB", 226 / 1024, ORANGE)
    y = bar_row(d, y, "自我上限 1 GB", "约 4.5 年才碰到", "1 GB", 1.0, PURPLE)
    y += 16
    y = para(d, y, "而且真到上限也不是崩：她会把最早的几段糊成「那阵子」，像人回忆童年那样。", 30, INK)
    footer(d, idx, total)

# ---------------- 二、记得准 ----------------
@page
def precise_1(d, idx, total):
    y = header(d, "记得准", "不是全塞进去，是打分挑", ORANGE)
    y = para(d, y, "她不可能把 2,143 条记忆通读一遍。每次开口前按四个信号排序，只取最相关的几条。", 32, MUTED)
    y += 22
    y = bar_row(d, y, "证据对得上", "原话里有这次说的词", "最强", 0.95, BLUE)
    y = bar_row(d, y, "锚点对上号", "提到的人、事、场景命中", "次之", 0.82, ORANGE)
    y = bar_row(d, y, "情绪有分量", "当时越难受越容易被想起", "加权", 0.66, PURPLE)
    y = bar_row(d, y, "被反复提起", "强度越高越靠前", "加权", 0.54, GREEN)
    y += 10
    y = callout(d, y, "1,200 token", "最后进提示词的记忆块有硬上限，超了按分数从低到高丢 —— 不相关的往事挤不进来", ORANGE)
    footer(d, idx, total)

@page
def precise_2(d, idx, total):
    y = header(d, "记得准", "每条记忆都能追到原话", ORANGE)
    y = para(d, y, "这是「质量好」最关键的一条：她不能凭空编，因为每条记忆都挂着证据。", 32, MUTED)
    y += 22
    d.rounded_rectangle([PAD, y, W - PAD, y + 210], radius=18, fill=(255, 255, 255), outline=LINE, width=2)
    d.text((PAD + 28, y + 20), "一条记忆", font=font(26, True), fill=ORANGE)
    d.text((PAD + 28, y + 62), "A 和 B 约定周六下午三点去露营", font=font(30, True), fill=INK)
    d.text((PAD + 28, y + 112), "证据：[t-3f2a] B：行，下午三点?", font=font(24), fill=MUTED)
    d.text((PAD + 28, y + 152), "情绪：期待 · 强度 0.5 · 关键事实：周六 / 15:00", font=font(24), fill=MUTED)
    y += 232
    y = bullets(d, y, [
        ("对不上原话就不入库", "抽取时 msg_id 必须在当天的对话里，编的一律丢掉"),
        ("改错了能改回来", "她可以改某条记忆的情绪，也可以删错记的"),
        ("没想起来 ≠ 装不知道", "是检索没命中，不是嘴上不认"),
    ], gap=22, accent=ORANGE)
    footer(d, idx, total)

@page
def precise_3(d, idx, total):
    y = header(d, "记得准", "从任何角度都能想起来", ORANGE)
    y = para(d, y, "一条记忆挂在好几个锚点上：人、事、场景、话题。从哪个角度问，都能走到它。", 32, MUTED)
    y += 16
    cx, cy = W // 2, y + 205
    nodes = [("人：阿牙易", -1, -1, ORANGE), ("事：露营", 1, -1, PURPLE), ("场景：那个群", -1, 1, GREEN), ("话题：计划表", 1, 1, RED)]
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
    y = para(d, y, "锚点之间还连成关系网（12,292 条边）：从「升职」能走到「我妈」。", 30, INK)
    y = para(d, y, "没用的边会自己变淡：热 15 天 / 温 3 天 / 冷 2 天半衰期。", 28, MUTED, 40)
    footer(d, idx, total)

@page
def precise_4(d, idx, total):
    y = header(d, "记得准", "情绪也跟着记忆走", ORANGE)
    y = para(d, y, "同样两件旧事，她更容易想起让她难受的那件 —— 这不是 bug，是人的记性。", 32, MUTED)
    y += 22
    y = bullets(d, y, [
        ("每条记忆带四个数", "正负、强度、情绪词、一句话感受"),
        ("「现在的感受」会更新", "当年 0.6 + 当前心境 0.15，一小时算一次"),
        ("情绪影响想起谁", "心境越激动，越容易翻出情绪强的旧事"),
        ("她自己能改词表", "「苦笑」以前被判成愉快，现在她能改"),
    ], gap=20, accent=ORANGE)
    footer(d, idx, total)

# ---------------- 三、很自主 ----------------
@page
def auto_1(d, idx, total):
    y = header(d, "很自主", "三种「自己动」，都不是等叫", PURPLE)
    y = para(d, y, "回话只是其中一种。她还有三种不等人叫的行为，各有触发条件。", 32, MUTED)
    y += 18
    y = row_card(d, y, "走神", "安静 30 秒后，85% 概率想起一件事", "今天 27 次", BLUE)
    y = row_card(d, y, "自主活动", "每 6 分钟一轮：查 B 站、摸手机、整理记忆", "今天 13 次", PURPLE)
    y = row_card(d, y, "主动开口", "想到是「人」且有话，才真的发消息", "今天 1 次", ORANGE)
    y += 14
    y = para(d, y, "走神和自主活动的区别：一个是被记忆勾起来的，一个是按计划去干活的。", 30, INK)
    footer(d, idx, total)

@page
def auto_2(d, idx, total):
    y = header(d, "很自主", "「不做」也是决定", PURPLE)
    y = para(d, y, "一个只会输出的 AI 很烦。会忍住不说的，才像有分寸。", 32, MUTED)
    y += 26
    y = bar_row(d, y, "今天走神", "想起一件事，权衡要不要做", "27", 1.0, PURPLE)
    y = bar_row(d, y, "判断为不做", "「没什么要做的」", "26", 26 / 27, MUTED)
    y = bar_row(d, y, "真正开口", "主动找你说一句", "1", 1 / 27, ORANGE)
    y += 18
    y = callout(d, y, "96%", "的走神以沉默结束 —— 沉默是判断的结果，不是没在想", GREEN)
    footer(d, idx, total)

@page
def auto_3(d, idx, total):
    y = header(d, "很自主", "想动之前，先过五道闸", PURPLE)
    y = para(d, y, "自主不等于放肆。每一轮都得先过这几道：", 32, MUTED)
    y += 16
    for head, note in [
        ("钱", "今天额度用完了就闭嘴（50 元/天）"),
        ("时间", "深夜不说话"),
        ("场合", "群里只在被 @ 或策略允许时开口"),
        ("审批", "要动大东西时先问人"),
        ("冷却", "刚说完不重复说"),
    ]:
        y = row_card(d, y, head, note, "", PURPLE, 104)
    y += 4
    y = para(d, y, "闸门是硬的，判断是她的 —— 她只能在允许的范围里选怎么做。", 30, INK)
    footer(d, idx, total)

@page
def auto_4(d, idx, total):
    y = header(d, "很自主", "她凭什么决定：四样东西", PURPLE)
    y = para(d, y, "不是随机，也不是写死的规则：把四样东西喂给她，她自己判断。", 32, MUTED)
    y += 18
    y = row_card(d, y, "① 记忆", "最近比较重的事、还没收尾的事", "来源", BLUE)
    y = row_card(d, y, "② 心境", "现在什么情绪，三档衰减", "状态", ORANGE)
    y = row_card(d, y, "③ 日程", "快到期的计划、待办", "任务", PURPLE)
    y = row_card(d, y, "④ 刚才的对话", "说到一半的话题最容易被接着想", "上下文", GREEN)
    y += 12
    y = para(d, y, "她自己写的那份「走神时该问自己什么」也在里面 —— 她可以改。", 30, INK)
    footer(d, idx, total)

# ---------------- 四、越用越聪明 ----------------
@page
def smart_1(d, idx, total):
    y = header(d, "越用越聪明", "她能改自己", GREEN)
    y = para(d, y, "这是这套系统最不一样的地方：有一批工具专门用来改自己，不是靠人替她调。", 32, MUTED)
    y += 18
    rows = [
        ("人格 persona", "改自己是谁、脾气、底线", "2,191 字", BLUE),
        ("说话规矩 speech", "改怎么说话、什么时候闭嘴", "655 字", ORANGE),
        ("抽取规则 extract", "改「怎么把聊天变成记忆」", "418 字", PURPLE),
        ("调参 tune_reply", "温度、轮次、每天记多少条", "12 项", GREEN),
        ("情绪词表 data_file", "加词、改权重、关掉误判词", "她自己写", RED),
    ]
    for head, note, right, color in rows:
        d.rounded_rectangle([PAD, y, W - PAD, y + 120], radius=16, fill=(255, 255, 255), outline=LINE, width=2)
        d.rounded_rectangle([PAD, y, PAD + 10, y + 120], radius=5, fill=color)
        d.text((PAD + 28, y + 14), head, font=font(30, True), fill=INK)
        d.text((PAD + 28, y + 62), note, font=font(24), fill=MUTED)
        d.text((W - PAD - 26 - d.textlength(right, font=font(24, True)), y + 48), right, font=font(24, True), fill=color)
        y += 132
    footer(d, idx, total)

@page
def smart_2(d, idx, total):
    y = header(d, "越用越聪明", "她真的改过（文件时间是证据）", GREEN)
    y = para(d, y, "不是「理论上能改」。这三个文件、十二个参数，都是她自己写进去的。", 32, MUTED)
    y += 20
    y = row_card(d, y, "data/persona.md", "人格文件", "今天 09:23", BLUE, 120)
    y = row_card(d, y, "data/tuning.json", "温度 / 轮次 / 门槛", "今天 09:59", ORANGE, 120)
    y = row_card(d, y, "data/speech-rules.md", "说话规矩", "昨天 23:45", PURPLE, 120)
    y = row_card(d, y, "data/extract-rules.md", "抽取规则", "昨天 18:30", GREEN, 120)
    y += 14
    y = para(d, y, "生效速度：人格、调参、词表 —— 下一句就生效；抽取规则 —— 下次整理记忆生效。", 30, INK)
    footer(d, idx, total)

@page
def smart_3(d, idx, total):
    y = header(d, "越用越聪明", "闭环：记忆 → 行为 → 改自己", GREEN)
    y = para(d, y, "四步围成一个环，每转一圈她都比上一圈更贴你一点。", 32, MUTED)
    y += 26
    cx, cy, r = W // 2, y + 260, 200
    labels = [("记忆", 0, BLUE), ("行为", 1, ORANGE), ("改自己", 2, PURPLE), ("新记忆", 3, GREEN)]
    pts = []
    for label, i, color in labels:
        ang = -math.pi / 2 + i * math.pi / 2
        pts.append((cx + int(r * math.cos(ang)), cy + int(r * math.sin(ang)), label, color))
    for i in range(4):
        x1, y1, _, _ = pts[i]
        x2, y2, _, _ = pts[(i + 1) % 4]
        d.line([(x1, y1), (x2, y2)], fill=(190, 200, 215), width=4)
        mx, my = x1 + (x2 - x1) * 0.62, y1 + (y2 - y1) * 0.62
        ang = math.atan2(y2 - y1, x2 - x1)
        s = 16
        d.polygon([(mx + s * math.cos(ang), my + s * math.sin(ang)),
                   (mx + s * math.cos(ang + 2.5), my + s * math.sin(ang + 2.5)),
                   (mx + s * math.cos(ang - 2.5), my + s * math.sin(ang - 2.5))], fill=(150, 162, 180))
    for px, py, label, color in pts:
        w = 240
        d.rounded_rectangle([px - w // 2, py - 44, px + w // 2, py + 44], radius=16, fill=(255, 255, 255), outline=color, width=4)
        tw = d.textlength(label, font=font(28, True))
        d.text((px - tw / 2, py - 20), label, font=font(28, True), fill=color)
    y = cy + 300
    y = para(d, y, "所以「越用越聪明」不是模型变强了，是她的记忆更准、规矩更合手、判断更有依据。", 30, INK)
    footer(d, idx, total)

# ---------------- 体检 ----------------
@page
def checkup(d, idx, total):
    y = header(d, "体检", "现在这套东西的真实数字")
    items = [
        ("2,143 条记忆", "3.7 天细节 / 12.6 天梗概 / 3.8 年骨架", BLUE),
        ("12,292 条关系边", "热 1,785 / 温 9,269 / 冷 1,102，有上限有半衰期", ORANGE),
        ("1,600 条底片", "原文 16.7 万字，永久保存", PURPLE),
        ("74 个工具", "看世界 18 / 记事情 22 / 说话 3 / 改自己 12", GREEN),
        ("今天 27 次走神", "其中 1 次主动开口，13 次自主活动", RED),
        ("每次对话 4,200 token", "记忆块上限 1,200，额度 50 元/天", MUTED),
    ]
    for name, note, color in items:
        y = row_card(d, y, name, note, "", color, 118)
    footer(d, idx, total)

# ---------------- 结尾 ----------------
@page
def end(d, idx, total):
    d.text((PAD, 320), "一句话", font=font(30, True), fill=BLUE)
    y = 410
    for line in ["她不是记得多，", "是每一层都知道", "该留什么、该丢什么。"]:
        d.text((PAD, y), line, font=font(70, True), fill=INK)
        y += 100
    y += 36
    y = para(d, y, "记得久，所以有过去；记得准，所以不瞎编；会自己动、会改自己，所以才有明天。", 32, MUTED, 50)
    y += 24
    d.line([(PAD, y), (PAD + 120, y)], fill=BLUE, width=6)
    y += 32
    para(d, y, "这套东西里没有一步是「等人喂」的。", 30, INK, 46)
    footer(d, idx, total)

total = len(PAGES)
os.makedirs(OUT, exist_ok=True)
for i, fn in enumerate(PAGES, start=1):
    img, dr = new_page()
    fn(dr, i, total)
    img.save(os.path.join(OUT, f"{i:02d}.png"))
print(f"{OUT} -> {total} 页")
