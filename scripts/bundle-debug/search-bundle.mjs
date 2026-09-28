import { readFileSync } from "node:fs";

const bundle = readFileSync("apps/mobile/android/app/src/main/assets/index.android.bundle");
const needle = Buffer.from("Got unexpected", "utf8");

let idx = -1;
const hits = [];
while ((idx = bundle.indexOf(needle, idx + 1)) !== -1) {
  hits.push(idx);
  if (hits.length > 20) break;
}
console.log("bundle size:", bundle.length, "hits:", hits.length);
for (const h of hits) {
  // 打印命中点前后各 120 字节的可打印字符，看上下文
  const ctx = bundle.slice(Math.max(0, h - 120), h + 160).toString("latin1");
  const printable = ctx.replace(/[^\x20-\x7e]/g, ".");
  console.log("@" + h + ": …" + printable + "…");
  console.log("---");
}
