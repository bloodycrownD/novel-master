#!/usr/bin/env node
/**
 * 在打出的 RN bundle（Hermes 字节码或明文）里搜字符串常量并打印命中点上下文。
 *
 * 用法：
 *   node scripts/bundle-debug/search-bundle.mjs <needle> [bundlePath]
 *   bundlePath 默认 apps/mobile/android/app/src/main/assets/index.android.bundle
 *
 * 场景：生产包崩溃/黑屏时只能拿到错误首行，用它确认该错误字符串是否进了产物，
 *   以及它周围的模块片段。例：2026-09-28 定位「Got unexpected undefined」。
 *   结论记录见 docs/apm/memory/20260927-worktree-123-verify-guide.md。
 *
 * 退出码：命中 ≥1 处 → 0；未命中 → 1；参数缺失 → 2。
 */

import { readFileSync } from "node:fs";

const [, , needleArg, bundleArg] = process.argv;
if (!needleArg) {
  console.error("用法：node scripts/bundle-debug/search-bundle.mjs <needle> [bundlePath]");
  process.exit(2);
}

const bundlePath = bundleArg ?? "apps/mobile/android/app/src/main/assets/index.android.bundle";
const bundle = readFileSync(bundlePath);
const needle = Buffer.from(needleArg, "utf8");

const hits = [];
let index = -1;
while ((index = bundle.indexOf(needle, index + 1)) !== -1 && hits.length <= 20) {
  hits.push(index);
}

console.log("bundle:", bundlePath, "size:", bundle.length, "needle:", JSON.stringify(needleArg), "hits:", hits.length);
for (const hit of hits) {
  // 打印命中点前后各 120/160 字节的可打印字符，看上下文
  const context = bundle.slice(Math.max(0, hit - 120), hit + 160).toString("latin1");
  console.log("@" + hit + ": …" + context.replace(/[^\x20-\x7e]/g, ".") + "…");
  console.log("---");
}

process.exitCode = hits.length > 0 ? 0 : 1;
