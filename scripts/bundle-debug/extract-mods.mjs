import { readFileSync } from "node:fs";

const b = readFileSync("apps/mobile/android/app/src/main/assets/index.android.bundle");
const s = b.toString("latin1");

function extractModule(id) {
  // metro 模块声明形如 __d(function(...){...},<id>,[deps]);
  const markers = [`,${id},[`, `},${id},[`];
  for (const mk of markers) {
    let idx = s.indexOf(mk);
    while (idx !== -1) {
      // 回退找 __d( 起点
      const start = s.lastIndexOf("__d(function", idx);
      if (start !== -1 && idx - start < 400000) {
        const chunk = s.slice(start, Math.min(start + 900, idx + 120));
        // 只在模块体较小时认为是命中（避免跨模块误配）
        if (idx - start < 300000) {
          return { start, chunk };
        }
      }
      idx = s.indexOf(mk, idx + 1);
    }
  }
  return null;
}

for (const id of [594, 593, 592, 590, 95, 46, 97, 23]) {
  const m = extractModule(id);
  if (!m) { console.log(`#${id}: NOT_FOUND`); continue; }
  // 打印模块体前 500 字节（可打印化），足够看字符串特征
  const body = s.slice(m.start, m.start + 500).replace(/[^\x20-\x7e]/g, ".");
  console.log(`#${id} @${m.start}:`);
  console.log(body);
  console.log("===");
}
