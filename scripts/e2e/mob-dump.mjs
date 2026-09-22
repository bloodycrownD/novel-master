// mobile 巡检辅助：解析 uiautomator dump 的 ui.xml，列出可见文本与坐标中心
// 用法：node mob-dump.mjs <ui.xml 路径> [过滤关键词]
import fs from "node:fs";

const [, , xmlPath, filter] = process.argv;
const xml = fs.readFileSync(xmlPath, "utf8");
const out = [];
for (const m of xml.matchAll(/text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
  const t = m[1];
  if (!t) continue;
  if (filter && !t.includes(filter)) continue;
  const x1 = Number(m[2]), y1 = Number(m[3]), x2 = Number(m[4]), y2 = Number(m[5]);
  out.push(`${t} @ (${Math.round((x1 + x2) / 2)},${Math.round((y1 + y2) / 2)})`);
}
console.log(out.join("\n") || "(no visible text)");
