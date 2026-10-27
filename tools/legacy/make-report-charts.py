import json
import math
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"C:\Users\Administrator\Documents\deepseek-harness\default-workspace\whale-memory\docs\report"
os.makedirs(OUT, exist_ok=True)
DATA = json.load(open(r"C:\Users\Administrator\Documents\deepseek-harness\default-workspace\whale-memory\data\memory-report.json", encoding="utf-8"))

FONT = r"C:\Windows\Fonts\msyh.ttc"
FONTB = r"C:\Windows\Fonts\msyhbd.ttc"

def f(size, bold=False):
    return ImageFont.truetype(FONTB if bold else FONT, size, index=0)

W, H = 1280, 720
BG = (255, 255, 255)
INK = (28, 32, 38)
MUTED = (110, 118, 128)
GRID = (228, 232, 238)
BLUE = (47, 111, 237)
ORANGE = (232, 148, 24)
PURPLE = (122, 90, 248)
GREEN = (22, 160, 100)

def canvas():
    img = Image.new("RGB", (W, H), BG)
    return img, ImageDraw.Draw(img)

def title(d, text, sub=None):
    d.text((56, 40), text, font=f(38, True), fill=INK)
    if sub:
        d.text((56, 92), sub, font=f(20), fill=MUTED)

def footer(d, text):
    d.text((56, H - 44), text, font=f(17), fill=MUTED)

# ---------- 图1：三层能装多少条（对数轴） ----------
img, d = canvas()
title(d, "三层记忆各能装多少条", "横轴为对数刻度；数字=容量上限，括号=按每天 714 条进料能撑多久")
left, right, top, bottom = 220, W - 120, 190, H - 130
lo, hi = 1e3, 2e6
def x_of(v):
    return left + (math.log10(v) - math.log10(lo)) / (math.log10(hi) - math.log10(lo)) * (right - left)
for tick in [1e3, 1e4, 1e5, 1e6]:
    x = x_of(tick)
    d.line([(x, top), (x, bottom)], fill=GRID, width=1)
    label = {1e3: "1 千", 1e4: "1 万", 1e5: "10 万", 1e6: "100 万"}[tick]
    tw = d.textlength(label, font=f(17))
    d.text((x - tw / 2, bottom + 10), label, font=f(17), fill=MUTED)
rows = [
    ("第三层 fossil", DATA["caps"]["fossil"], "1,000,000 条（≈3.8 年）", PURPLE),
    ("第二层 compressed", DATA["caps"]["compressed"], f"{DATA['caps']['compressed']:,} 条（≈12.6 天）", ORANGE),
    ("第一层 detailed", DATA["caps"]["detailed"], f"{DATA['caps']['detailed']:,} 条（≈3.7 天）", BLUE),
]
bar_h, gap = 74, 42
for i, (name, value, note, color) in enumerate(rows):
    y = top + i * (bar_h + gap) + 10
    x = x_of(max(value, lo))
    d.rounded_rectangle([left, y, x, y + bar_h], radius=10, fill=color)
    d.text((left - 12 - d.textlength(name, font=f(21, True)), y + 18), name, font=f(21, True), fill=INK)
    tw = d.textlength(note, font=f(20))
    if x + 16 + tw > W - 40:
        d.text((x - 16 - tw, y + 22), note, font=f(20), fill=(255, 255, 255))
    else:
        d.text((x + 16, y + 22), note, font=f(20), fill=INK)
footer(d, "数据来源：data/memory.db 实测 · 预算 1,000,000 token · 进料 714 条/天")
img.save(os.path.join(OUT, "layer-capacity.png"))

# ---------- 图2：三档半衰期 ----------
img, d = canvas()
title(d, "一条边变淡有多快：按它挂着的记忆在哪一层", "纵轴为权重（对数）；横线是各自的删除底线")
left, right, top, bottom = 150, W - 300, 200, H - 130
def px(day):
    return left + day / 30 * (right - left)
def py(w):
    return bottom - (math.log10(w) - math.log10(0.01)) / (math.log10(4) - math.log10(0.01)) * (bottom - top)
for day in range(0, 31, 5):
    d.line([(px(day), top), (px(day), bottom)], fill=GRID)
    d.text((px(day) - 14, bottom + 10), f"{day}天", font=f(17), fill=MUTED)
for w in [0.01, 0.1, 1, 3]:
    d.line([(left, py(w)), (right, py(w))], fill=GRID)
    d.text((left - 58, py(w) - 11), f"{w}", font=f(17), fill=MUTED)
curves = [("热边 15 天", 15, 0.05, BLUE), ("温边 3 天", 3, 0.10, ORANGE), ("冷边 2 天", 2, 0.20, PURPLE)]
for name, half, floor, color in curves:
    pts = []
    for t in range(0, 301):
        day = t / 10
        w = 3 * math.pow(0.5, day / half)
        pts.append((px(day), py(max(w, 0.01))))
    d.line(pts, fill=color, width=4, joint="curve")
    d.line([(left, py(floor)), (right, py(floor))], fill=color, width=2)
    d.text((right + 14, py(floor) - 12), f"底线 {floor}", font=f(17), fill=color)
# 图例放右上，别和曲线挤在一起
lx, ly = right + 14, top + 6
for name, _half, _floor, color in curves:
    d.line([(lx, ly + 9), (lx + 34, ly + 9)], fill=color, width=4)
    d.text((lx + 44, ly), name, font=f(19, True), fill=color)
    ly += 34
d.text((left, top - 46), "起点都按权重 3.0 算", font=f(18), fill=MUTED)
footer(d, "热边：还挂着 detailed 记忆 · 温边：只剩 compressed · 冷边：只剩 fossil")
img.save(os.path.join(OUT, "edge-halflife.png"))

# ---------- 图3：一年磁盘 ----------
img, d = canvas()
title(d, "一年下来磁盘长多少（冷存储 + 记忆本体）", "按月累计；虚线是 1 GB 的自我上限")
left, right, top, bottom = 150, W - 120, 200, H - 140
per_month = DATA["perDay"] * 30 * 0.9 / 1024  # MB
max_mb = 1024
def px(m):
    return left + m / 12 * (right - left)
def py(mb):
    return bottom - mb / max_mb * (bottom - top)
for m in range(0, 13):
    d.line([(px(m), top), (px(m), bottom)], fill=GRID)
    tw = d.textlength(f"{m}月", font=f(16))
    d.text((px(m) - tw / 2, bottom + 10), f"{m}月", font=f(16), fill=MUTED)
for mb in [0, 256, 512, 768, 1024]:
    d.line([(left, py(mb)), (right, py(mb))], fill=GRID)
    d.text((left - 78, py(mb) - 11), f"{mb} MB", font=f(16), fill=MUTED)
pts = [(px(m), py(per_month * m)) for m in range(0, 13)]
d.line([(left, py(0)), (right, py(0))], fill=GRID)
d.line([(left, py(1024)), (right, py(1024))], fill=(200, 60, 60), width=2)
poly = pts + [(right, py(0)), (left, py(0))]
d.polygon(poly, fill=(232, 240, 255))
d.line(pts, fill=BLUE, width=4, joint="curve")
d.ellipse([pts[-1][0] - 7, pts[-1][1] - 7, pts[-1][0] + 7, pts[-1][1] + 7], fill=BLUE)
d.text((pts[-1][0] - 210, pts[-1][1] - 58), f"12 个月 ≈ {per_month * 12:.0f} MB", font=f(22, True), fill=BLUE)
years_to_gb = 1024 / (per_month * 12)
d.text((right - 360, py(1024) - 40), f"1 GB 上限 ≈ {years_to_gb:.1f} 年才碰到", font=f(19, True), fill=(200, 60, 60))
footer(d, "每年约 %.0f MB：「化石行 + 底片原文」按每条 0.9 KB、每天 714 条算" % (per_month * 12))
img.save(os.path.join(OUT, "disk-growth.png"))

# ---------- 图4：一条记忆的一生 ----------
img, d = canvas()
title(d, "一条记忆的一生", "同一条记忆在三个阶段里「体积」越来越小，但一直在")
left, right, top = 90, W - 90, 230
stages = [
    ("第 0–3.7 天\n第一层 detailed", "标题+正文+前因后果\n+感受+关键事实\n113 token", BLUE, 0.30),
    ("第 3.7–16.4 天\n第二层 compressed", "正文丢掉\n只剩标题+片段+感受\n55 token", ORANGE, 0.26),
    ("第 16.4 天起\n第三层 fossil", "前因后果也丢掉\n只剩感受+一个片段\n40 token", PURPLE, 0.30),
]
x = left
for i, (head, body, color, frac) in enumerate(stages):
    w = (right - left) * frac
    d.rounded_rectangle([x, top, x + w - 14, top + 190], radius=14, fill=color)
    for j, line in enumerate(head.split("\n")):
        d.text((x + 18, top + 16 + j * 26), line, font=f(20, True), fill=(255, 255, 255))
    for j, line in enumerate(body.split("\n")):
        d.text((x + 18, top + 84 + j * 25), line, font=f(17), fill=(255, 255, 255))
    x += w
# 底层：原文永久
d.rounded_rectangle([left, top + 250, right, top + 340], radius=14, fill=(240, 245, 255), outline=BLUE, width=2)
d.text((left + 22, top + 266), "原文从头到尾都在：cold_archive（底片）", font=f(22, True), fill=BLUE)
d.text((left + 22, top + 300), "每次被压缩前都把全文写进去，留一个 cold://<编号> 地址；平时不读（不占 token），真需要按地址取回来", font=f(17), fill=INK)
x = left
for label, frac, color in [("持续 3.7 天", 0.30, BLUE), ("持续 12.7 天", 0.26, ORANGE), ("写满约 3.8 年", 0.30, PURPLE)]:
    w = (right - left) * frac
    d.text((x + 6, top + 200), label, font=f(18, True), fill=color)
    x += w
footer(d, "三层合计：第一层 3.7 天 + 第二层 12.7 天 + 第三层约 1,400 天 ≈ 3.9 年")
img.save(os.path.join(OUT, "memory-life.png"))

print("ok", os.listdir(OUT))
