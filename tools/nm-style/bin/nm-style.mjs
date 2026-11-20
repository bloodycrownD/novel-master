#!/usr/bin/env node
// 用途：nm-style CLI 薄启动器——src 比 dist 旧时自动 tsc 编译，再拉起 dist/cli.js 并透传退出码。
// 用法：nm-style <command> [args...]（参数原样透传；等价于 node <包根>/dist/cli.js）。
// 退出码：透传 CLI 退出码（0=干净 / 1=有发现 / 2=用法错误）；编译失败或 typescript 缺失 = 3。
// 说明：编译产物经临时目录 + 原子换名落盘，并发读者永远看到完整的 dist；并发启动器以锁文件
//       串行化（陈锁 >120s 强占防死等）；tsc 一律 spawnSync(process.execPath, [tscBin, ...])
//       数组式调用（win32 下 .cmd shim 不可直接 spawn 的坑）。
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(pkgRoot, "src");
const distDir = path.join(pkgRoot, "dist");
const distTmp = path.join(pkgRoot, "dist-tmp");
const distOld = path.join(pkgRoot, "dist-old");
const distCli = path.join(distDir, "cli.js");
const lockFile = path.join(pkgRoot, ".build-lock");
const tsconfig = path.join(pkgRoot, "tsconfig.json");

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs);
  }
  return newest;
}

function isStale() {
  return !existsSync(distCli) || newestMtime(srcDir) > statSync(distCli).mtimeMs;
}

function findTscBin(startDir) {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", "typescript", "bin", "tsc");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function tryAcquireLock() {
  try {
    closeSync(openSync(lockFile, "wx"));
    return true;
  } catch {
    return false;
  }
}

function stealStaleLock() {
  try {
    if (Date.now() - statSync(lockFile).mtimeMs > 120_000) {
      unlinkSync(lockFile);
      return true;
    }
    return false;
  } catch {
    return true; // 锁恰好消失，调用方直接重试获取即可。
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 返回退出码：0=构建成功（或无需构建）；3=构建失败。不直接 process.exit——锁的释放统一由调用方 finally 负责，
// 否则 exit(3) 会跳过锁清理、把 .build-lock 留给下一位等 120s 陈锁强占。
function build() {
  const tscBin = findTscBin(pkgRoot);
  if (tscBin == null) {
    console.error("nm-style: 沿目录向上找不到 node_modules/typescript/bin/tsc；请先在仓库根执行 npm install。");
    return 3;
  }
  // 无锁状态下的半成品临时目录只可能是上次崩溃的残留，直接清掉重编。
  rmSync(distTmp, { recursive: true, force: true });
  let res = spawnSync(process.execPath, [tscBin, "-p", tsconfig, "--outDir", distTmp], { stdio: "inherit" });
  if (res.error != null) {
    // spawn 自身失败（status=null）与编译失败不同：多为瞬时资源问题，重试一次再定论。
    console.error(`nm-style: tsc 启动失败（${res.error.code ?? "unknown"}）：${res.error.message}`);
    res = spawnSync(process.execPath, [tscBin, "-p", tsconfig, "--outDir", distTmp], { stdio: "inherit" });
  }
  if (res.error != null || res.status !== 0) {
    rmSync(distTmp, { recursive: true, force: true });
    if (res.error != null) console.error(`nm-style: tsc 启动重试仍失败（${res.error.code ?? "unknown"}）：${res.error.message}`);
    else console.error("nm-style: 编译失败。");
    return 3;
  }
  rmSync(distOld, { recursive: true, force: true });
  if (existsSync(distDir)) renameSync(distDir, distOld);
  renameSync(distTmp, distDir);
  rmSync(distOld, { recursive: true, force: true });
  return 0;
}

/** 返回构建退出码（0=无需或完成，3=失败）；无论成败都释放锁。 */
function ensureFreshBuild() {
  // 拿不到锁说明有并发启动器在编译：等它完工（或强占陈锁），拿到锁后复检——可能等锁期间对方已建好。
  while (!tryAcquireLock()) {
    if (!isStale()) return 0;
    if (!existsSync(lockFile)) continue;
    if (stealStaleLock()) continue;
    sleep(200);
  }
  try {
    if (isStale()) return build();
    return 0;
  } finally {
    try {
      unlinkSync(lockFile);
    } catch {
      // 锁已被强占则让位，不再删除别人的锁。
    }
  }
}

function run() {
  const res = spawnSync(process.execPath, [distCli, ...process.argv.slice(2)], { stdio: "inherit" });
  return res.status ?? 1;
}

if (isStale()) {
  const buildExit = ensureFreshBuild();
  if (buildExit !== 0) process.exit(buildExit);
}
process.exit(run());
