// 解析 uiautomator dump 的 ui.xml：列出 text/content-desc 非空节点的文字 + bounds + resource-id
// 用法: node uidump.mjs [filter]   filter=focus 时只打印 focused 节点
import { readFileSync } from "node:fs";
const xml = readFileSync(new URL("./ui.xml", import.meta.url), "utf8");
const filter = process.argv[2] ?? "";
if (filter === "focus") {
  for (const m of xml.matchAll(/<node[^>]*focused="true"[^>]*>/g)) {
    const n = m[0];
    const t = /text="([^"]*)"/.exec(n);
    const b = /bounds="([^"]*)"/.exec(n);
    const c = /class="([^"]*)"/.exec(n);
    console.log("FOCUSED", c?.[1], t?.[1], b?.[1]);
  }
} else {
  const re = /<node[^>]*?(?:text|content-desc)="([^"]+)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*?(?:resource-id="([^"]*)")?[^>]*?\/?>/g;
  for (const m of xml.matchAll(re)) {
    const [, label, x1, y1, x2, y2, rid] = m;
    if (!label || label === "") continue;
    const line = `${label}  [${x1},${y1}-${x2},${y2}]  rid=${rid ?? ""}`;
    if (filter === "" || line.includes(filter)) console.log(line);
  }
}
