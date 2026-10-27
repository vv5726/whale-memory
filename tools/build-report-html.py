import base64
import os

HERE = r"C:\Users\Administrator\Documents\deepseek-harness\default-workspace\whale-memory\docs\report"

def b64(name):
    with open(os.path.join(HERE, name), "rb") as fh:
        return "data:image/png;base64," + base64.b64encode(fh.read()).decode("ascii")

tpl = open(os.path.join(HERE, "report.tpl.html"), encoding="utf-8").read()
out = (
    tpl.replace("{{IMG_LIFE}}", b64("memory-life.png"))
    .replace("{{IMG_CAP}}", b64("layer-capacity.png"))
    .replace("{{IMG_HALF}}", b64("edge-halflife.png"))
    .replace("{{IMG_DISK}}", b64("disk-growth.png"))
)
path = os.path.join(HERE, "记忆为什么能记很久.html")
open(path, "w", encoding="utf-8").write(out)
print("wrote", path, len(out), "chars")
