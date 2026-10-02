#!/usr/bin/env node
/**
 * test:collect-guard 的共用实现（wave-e H6 钩子⑥ · CR-F12）。
 *
 * 为什么要有这一份：H6 的立论是「N-P0-02 那类假绿**只在 Windows 出现**（单引号 + shell:true
 * ⇒ Linux 绿 / Windows 静默空跑），所以必须在两种 shell 上各跑一遍」。落地时只有 apps/cli
 * 暴露了 `test:collect-guard`，`npm run test:collect-guard --workspaces --if-present` 在
 * windows-latest 那一格只验证了 cli 的 fs 递归（一个**不经过 shell**的收集器），
 * 而病灶本体 apps/desktop 与主战场 packages/core 被 --if-present 静默跳过。
 *
 * 用途：只跑「收集」这一步并断言非零（不起全量测试），跨 shell 验证收集逻辑；
 * 真正的全量运行入口各包自己的 test 脚本。
 *
 * 牙齿：把 --dir 指到不存在的目录、或把后缀写成不存在的扩展名 ⇒ 收集数 0 ⇒ exit 1。
 *
 * 用法（在**包目录**下跑，CI 的 --workspaces 就是这么调的）：
 *   node ../../scripts/collect-check.mjs                 # 默认扫 test/，*.test.ts
 *   node ../../scripts/collect-check.mjs --dir test --ext .test.ts,.test.tsx
 *   node ../../scripts/collect-check.mjs --dir src       # 指到不存在 ⇒ 必须红
 *
 * ⚠️ apps/desktop **不用**这一份：desktop 的收集是「Node 侧枚举 + shell glob 双轨」
 *    （run-tests.mjs 仍把目标交给 shell:true 展开），它要额外真验一次 spawn 形态，
 *    见 apps/desktop/scripts/collect-check.mjs。
 */
import fs from "node:fs";
import path from "node:path";
import { assertNonZeroCollected } from "./lib/zero-collect-guard.mjs";

const packageRoot = process.cwd();

function parseArgs(argv) {
  let dir = "test";
  let extensions = [".test.ts"];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") dir = argv[++i];
    else if (arg === "--ext") extensions = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else {
      console.error(`[collect-check] 无法识别的参数：${arg}`);
      process.exit(1);
    }
  }
  return { dir, extensions };
}

const { dir, extensions } = parseArgs(process.argv.slice(2));
const scanRoot = path.resolve(packageRoot, dir);

function collectTestFiles(root, exts) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...collectTestFiles(full, exts));
    else if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out.sort();
}

const files = fs.existsSync(scanRoot) ? collectTestFiles(scanRoot, extensions) : [];
let packageName = "(unknown)";
try {
  packageName = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).name;
} catch {
  // package.json 读不到不影响判定，只是诊断信息少一行。
}

console.log(
  `[collect-check] ${packageName} 扫描面 ${scanRoot}（递归 ${extensions.join(" / ")}），收集到 ${files.length} 个文件`,
);
// 守卫本体与各包 run-tests.mjs 共用仓内 scripts/lib/zero-collect-guard.mjs（H6.6：只有一份）。
assertNonZeroCollected({
  collected: files.length,
  where: `${packageName} collect-check.mjs`,
  details: [`扫描面 ${scanRoot}`, `后缀 ${extensions.join(" / ")}`],
});