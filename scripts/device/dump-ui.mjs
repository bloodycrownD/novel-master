// 读 uiautomator dump 的 XML，打印「文字 | 坐标 | 类名 | 可点」清单（真机 UI 操作用）
import fs from "node:fs";
const xml = fs.readFileSync(process.argv[2], "utf8");
let n = 0;
for (const m of xml.matchAll(/<node[^>]*>/g)) {
  const s = m[0];
  const t = /text="([^"]*)"/.exec(s)?.[1] ?? "";
  const d = /content-desc="([^"]*)"/.exec(s)?.[1] ?? "";
  const b = /bounds="([^"]*)"/.exec(s)?.[1] ?? "";
  const cls = /class="([^"]*)"/.exec(s)?.[1] ?? "";
  const clk = /clickable="true"/.test(s);
  const id = /resource-id="([^"]*)"/.exec(s)?.[1] ?? "";
  if (!t && !d) continue;
  if (++n > 60) break;
  const label = t || ("desc:" + d);
  console.log(`${clk ? "[CLK]" : "     "} ${label} | ${b} | ${cls.replace("android.widget.", "")}${id ? " | " + id : ""}`);
}
