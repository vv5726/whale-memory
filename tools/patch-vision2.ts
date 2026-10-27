import { readFileSync, writeFileSync } from "node:fs";

const helper = `
export async function describeImagesInText(text: string, dataDir: string): Promise<string> {
  const codes = /\\[CQ:image,([^\\]]*)\\]/g;
  const found: Array<{ full: string; url: string; summary: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = codes.exec(text)) !== null) {
    const attrs = m[1] ?? "";
    const url = /url=([^,\\]]+)/.exec(attrs)?.[1];
    const summary = /summary=([^,\\]]*)/.exec(attrs)?.[1] ?? "";
    if (url) found.push({ full: m[0], url: decodeURIComponent(url.replace(/&amp;/g, "&")), summary });
  }
  if (found.length === 0) return text;

  let out = text;
  for (const item of found.slice(0, 3)) {
    try {
      const res = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
      const file = join(dataDir, "images", hash + ".jpg");
      mkdirSync(join(dataDir, "images"), { recursive: true });
      writeFileSync(file, buf);
      const r = await describeImage(file);
      const desc = r.ok ? r.text.replace(/\\s+/g, " ").slice(0, 200) : item.summary || "看不清";
      out = out.replace(item.full, \`[发了张图：\${desc}]\`);
    } catch {
      out = out.replace(item.full, item.summary ? \`[发了张图：\${item.summary}]\` : "[发了张图，看不清]");
    }
  }
  return out;
}
`;

const p = "src/vision.ts";
let s = readFileSync(p, "utf8");

if (!s.includes("describeImagesInText")) {
  s = s.replace(
    'import { existsSync, readFileSync } from "node:fs";',
    'import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";',
  );
  s = s.replace('import { extname } from "node:path";', 'import { extname, join } from "node:path";\nimport { createHash } from "node:crypto";');
  s += helper;
  writeFileSync(p, s, "utf8");
  console.log("describeImagesInText 已加");
} else {
  console.log("已经有了");
}
