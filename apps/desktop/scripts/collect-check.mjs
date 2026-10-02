/**
 * test:collect-guard（wave-e H6 钩子⑥ · CR-F12）—— desktop 版。
 *
 * 为什么要 desktop 单独一份，而不是直接用仓内 scripts/collect-check.mjs：
 * desktop 的收集是**双轨**的——run-tests.mjs:30-33 把三个目标整体加双引号交给
 * `shell: true` 展开（单引号只在 Linux 生效，Windows 上会被 shell 吃掉 ⇒ 静默空跑，
 * 这就是 N-P0-02）。纯 fs 枚举只能证明「文件在」，证不了「双引号在 Windows 上真能展开」。
 * 所以这里多做一步：**复刻 run-tests.mjs 的 spawn 形态**（同样的 shell:true、同样的双引号
 * 目标、同样的 tsx/tsconfig 参数）真跑一个单文件，断言 `# tests > 0`。
 *
 * 两道牙齿：
 *  ① 枚举面：`test/` 下递归三个后缀（与 run-tests.mjs:33 的三个 glob 对齐），0 个 ⇒ 红；
 *  ② spawn 面：把 glob 改回单引号（或指向不存在的路径）⇒ 子进程收集 0 条 ⇒ 红。
 *
 * 用法：node scripts/collect-check.mjs（不需要参数；全量运行入口是 scripts/run-tests.mjs）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertNonZeroCollected,
  parseCollectedCount,
} from "../../../scripts/lib/zero-collect-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const testRoot = path.join(desktopRoot, "test");
// 与 run-tests.mjs:33 的三个 glob 逐字对齐（后缀互不重叠、无重复）。
const TEST_EXTENSIONS = [".test.ts", ".test.tsx", ".test.js"];

function collectTestFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTestFiles(full));
    else if (entry.isFile() && TEST_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out.sort();
}

const files = fs.existsSync(testRoot) ? collectTestFiles(testRoot) : [];
console.log(`[collect-check] 扫描面 ${testRoot}（递归 ${TEST_EXTENSIONS.join(" / ")}），收集到 ${files.length} 个文件`);
assertNonZeroCollected({
  collected: files.length,
  where: "apps/desktop collect-check.mjs",
  details: [`扫描面 ${testRoot}`, `后缀 ${TEST_EXTENSIONS.join(" / ")}`],
});

// —— 真验引号语义：复刻 run-tests.mjs 的 spawn 形态跑一个单文件 ——
if (files.length === 0) {
  // 上面的守卫已经 exit 1 了，走不到这里。
  process.exit(1);
}
const probeTarget = path.relative(desktopRoot, files[0]).split(path.sep).join("/");
const registerMock = pathToFileURL(path.join(testRoot, "register-electron-mock.mjs")).href;
const env = {
  ...process.env,
  NODE_OPTIONS: process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} --import ${registerMock}` : `--import ${registerMock}`,
};
// ⚠️ 双引号 + shell:true 是**故意**与 run-tests.mjs 同形的：这里改成单引号，Windows 上
//    子进程会收集 0 条而退出码仍是 0（本守卫存在的全部理由）。
const probeCommand = `npx tsx --tsconfig tsconfig.renderer.json --test "${probeTarget}"`;
const MAX_BUFFER = 16 * 1024 * 1024; // 单文件足够；默认 1 MiB 太小，spawnSync 会静默截断
const probe = spawnSync(probeCommand, {
  cwd: desktopRoot,
  stdio: ["inherit", "pipe", "inherit"],
  env,
  shell: true,
  encoding: "utf8",
  maxBuffer: MAX_BUFFER,
});
process.stdout.write(probe.stdout ?? "");
if (probe.error != null) {
  console.error(
    `[collect-check] 引号语义探针子进程异常：${probe.error.code ?? probe.error.message}；` +
      `stdout 已截断（上限 ${MAX_BUFFER} 字节）。`,
  );
  process.exit(1);
}
assertNonZeroCollected({
  collected: parseCollectedCount(probe.stdout ?? ""),
  where: "apps/desktop collect-check.mjs (spawn 探针)",
  details: [
    `目标 ${probeTarget}（引号形态：双引号）`,
    `命令 ${probeCommand}`,
    `shell=${process.platform}`,
    "这一格红 ⇒ glob 的引号语义在当前 shell 下真的展开不了（N-P0-02 的形态）。",
  ],
});
console.log(`[collect-check] 引号语义探针 GREEN：单文件 ${probeTarget} 收集到用例。`);