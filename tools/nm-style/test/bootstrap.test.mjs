// T-BS1~T-BS3：bin/nm-style.mjs 启动器——staleness 自动重编译 / 编译失败 exit 3 且无锁残留 / --help exit 2。
// 三个用例直接操作包本体（真实 src/ 与 dist/，优先不复制包），会真实触发 tsc 编译（秒级）；与全量套件
// 并发跑时，重编译由启动器的 .build-lock 构建互斥串行化（成功路径并发安全）；T-BS2 的坏文件窗口内，
// 其他测试文件经 BIN 起的进程也会拿到 exit 3（实测 2026-11-20：默认并发 6 跑 3 红），故兜底命令（spec §七）：
//   node --test --test-concurrency=1 "test/*.test.mjs"（实测串行 7 跑 5 绿，2 红为他文件瞬时 EBUSY/一次 tsc 失败，见交付报告）
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(PKG_ROOT, "bin", "nm-style.mjs");
const SRC_CLI = path.join(PKG_ROOT, "src", "cli.ts");
const DIST_CLI = path.join(PKG_ROOT, "dist", "cli.js");
const LOCK_FILE = path.join(PKG_ROOT, ".build-lock");
const BROKEN_FIXTURE = path.join(PKG_ROOT, "src", "tbs2-broken-fixture.ts");

function runBin(args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: PKG_ROOT, encoding: "utf8" });
}

/** 把文件的 mtime 设为 epochMs（atime 同值，Windows 下 utimes 双参必填）。 */
function setMtime(file, epochMs) {
  fs.utimesSync(file, new Date(epochMs), new Date(epochMs));
}

test("T-BS1 staleness：src 比 dist 新时启动器自动重编译，命令正常退出且无锁残留", () => {
  if (!fs.existsSync(DIST_CLI)) assert.equal(runBin(["--help"]).status, 2, "冷启动前置：首跑应自动建出 dist");
  const before = fs.statSync(DIST_CLI).mtimeMs;
  setMtime(SRC_CLI, before + 1000); // 顶到 dist 之后（1s 余量，远超 mtimeMs 精度），制造「src 比 dist 新」；内容不动
  try {
    const res = runBin(["--help"]);
    assert.equal(res.status, 2, `重编译后 --help 应透传用法退出码 2，实际 ${res.status}；stderr=${res.stderr}`);
    assert.ok(res.stdout.includes("nm-style <command>"), "重建出的 CLI 应正常打印用法");
    const after = fs.statSync(DIST_CLI).mtimeMs;
    assert.ok(after >= before + 200, `dist/cli.js 应被重编译（mtime 前进，留 200ms 精度余量）：before=${before} after=${after}`);
    assert.equal(fs.existsSync(LOCK_FILE), false, "编译完成后 .build-lock 不应残留");
  } finally {
    // 恢复现场：把 src/cli.ts 压回 dist 之下，保证套件后续调用不再空转重编译。
    try {
      setMtime(SRC_CLI, fs.statSync(DIST_CLI).mtimeMs - 5000);
    } catch { /* dist 已缺失的异常场景下不再折腾 */ }
  }
});

test("T-BS2 编译失败：exit 3、.build-lock 不残留（锁清理回归锚）、dist 不被破坏；删除坏文件后恢复 exit 2", () => {
  assert.equal(fs.existsSync(BROKEN_FIXTURE), false, "前置：坏文件夹具不应已存在");
  const distBefore = fs.statSync(DIST_CLI).mtimeMs;
  fs.writeFileSync(BROKEN_FIXTURE, "const brokenFixture: = 1;\n"); // 语法级坏文件，tsc 必报错
  try {
    const failure = runBin(["--help"]);
    assert.equal(failure.status, 3, `编译失败应 exit 3（不与 0/1/2 混淆），实际 ${failure.status}；stderr=${failure.stderr}`);
    assert.ok(failure.stderr.includes("编译失败"), `stderr 应给出编译失败报错；stderr=${failure.stderr}`);
    assert.equal(fs.existsSync(LOCK_FILE), false, "exit 3 后 .build-lock 不应残留（ensureFreshBuild finally 释放锁的回归锚）");
    assert.ok(fs.existsSync(DIST_CLI), "编译失败不得破坏既有 dist");
  } finally {
    fs.rmSync(BROKEN_FIXTURE, { force: true }); // 测后删除，恢复 src 干净态
  }
  const recovered = runBin(["--help"]);
  assert.equal(recovered.status, 2, `删除坏文件后应恢复 exit 2，实际 ${recovered.status}；stderr=${recovered.stderr}`);
  assert.ok(recovered.stdout.includes("nm-style <command>"), "恢复后 --help 应打印用法");
  assert.equal(fs.existsSync(LOCK_FILE), false, "恢复后同样无锁残留");
});

test("T-BS3 --help：干净状态下 exit 2 且 stdout 含用法（修旧 parseFlags 静默全扫的坑）", () => {
  assert.equal(fs.existsSync(BROKEN_FIXTURE), false, "前置：src 应处于干净态");
  const res = runBin(["--help"]);
  assert.equal(res.status, 2, `--help 应 exit 2，实际 ${res.status}；stderr=${res.stderr}`);
  assert.ok(res.stdout.includes("nm-style <command> [args...]"), "stdout 应含用法首行");
  assert.ok(res.stdout.includes("commands:"), "stdout 应含子命令清单");
  assert.ok(res.stdout.includes("exit codes: 0=干净 1=有发现 2=用法错误 3=构建失败"), "stdout 应含退出码说明");
  assert.equal(fs.existsSync(LOCK_FILE), false, "无锁残留");
});
