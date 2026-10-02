/**
 * test:collect-guard（wave-e H6 钩子⑥ · CR-F12）—— core 版薄封装。
 *
 * core 的收集逻辑本体在 scripts/run-tests.mjs（fs 递归 test/ + 排除 performance.test.ts），
 * 枚举与断言的共用实现在仓根 scripts/collect-check.mjs（与各驱动包同一份，H6.6「只有一份」）。
 * 这里只做 core 的参数固定：扫 test/、后缀 .test.ts。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const coreRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const shared = path.join(coreRoot, "..", "..", "scripts", "collect-check.mjs");

// 直接转发进程：cwd 交给 npm（= core 包目录），参数原样带过去。
const result = spawnSync(process.execPath, [shared, "--dir", "test", "--ext", ".test.ts", ...process.argv.slice(2)], {
  cwd: coreRoot,
  stdio: "inherit",
});
process.exit(result.status ?? 1);