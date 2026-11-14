#!/usr/bin/env node
/**
 * 按 metro 模块号从 bundle 里提取 `__d(function…)` 模块体片段。
 *
 * 用法：
 *   node scripts/bundle-debug/extract-mods.mjs <id> [<id> …] [--bundle <path>]
 *   --bundle 默认 apps/mobile/android/app/src/main/assets/index.android.bundle
 *
 * 场景：拿到崩溃栈里形如 `anonymous@594:5900` 的帧，用它把对应模块体打出来看
 *   是哪个依赖/哪段代码。契约：栈帧的「行号」是模块号（Hermes 字节码压平后）。
 *   例：2026-09-28 定位「Got unexpected undefined」时按 `[594,593,592,590,95,46,97,23]`
 *   批量导出。
 *
 * 退出码：0（未命中的 id 会在输出里标 NOT_FOUND）。
 */

import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const bundleIndex = argv.indexOf("--bundle");
const bundlePath = bundleIndex >= 0 ? argv[bundleIndex + 1] : "apps/mobile/android/app/src/main/assets/index.android.bundle";
const ids = argv
  .filter((_, index) => bundleIndex < 0 || (index !== bundleIndex && index !== bundleIndex + 1))
  .map((raw) => Number(raw))
  .filter((id) => Number.isInteger(id));

if (ids.length === 0) {
  console.error("用法：node scripts/bundle-debug/extract-mods.mjs <id> [<id> …] [--bundle <path>]");
  process.exit(2);
}

const raw = readFileSync(bundlePath).toString("latin1");

function extractModule(id) {
  // metro 模块声明形如 __d(function(...){...},<id>,[deps]);
  for (const marker of [`,${id},[`, `},${id},[`]) {
    let index = raw.indexOf(marker);
    while (index !== -1) {
      const start = raw.lastIndexOf("__d(function", index);
      // 只在跨度合理时认命中（避免跨模块误配）
      if (start !== -1 && index - start < 300000) {
        return { start, chunk: raw.slice(start, Math.min(start + 900, index + 120)) };
      }
      index = raw.indexOf(marker, index + 1);
    }
  }
  return null;
}

console.log("bundle:", bundlePath);
for (const id of ids) {
  const found = extractModule(id);
  if (!found) {
    console.log(`#${id}: NOT_FOUND`);
    continue;
  }
  console.log(`#${id} @${found.start}:`);
  console.log(raw.slice(found.start, found.start + 500).replace(/[^\x20-\x7e]/g, "."));
  console.log("===");
}
