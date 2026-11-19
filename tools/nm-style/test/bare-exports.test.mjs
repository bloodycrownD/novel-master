// T-BA1~T-BA3：bare-exports 规则——--changed 新增报 / HEAD 既有名不报 / 同名重载去重保留首行，
// 外加豁免链四件套（.tsx PascalCase / use* / keep-bare 前 3 行窗口 / 域过滤）与 CLI 层端到端。
// git 依赖用例在包内 gitignored 的 tmp-git-test/ 下临时 git init 构造（子目录名带 tba- 前缀，
// 与 git.test.mjs 的 lb1-*/lb2-* 不冲突），用完即删。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addedLineFilter } from "../dist/lib/git.js";
import { bareExportsOf, isInBareDomain, scanBareExports } from "../dist/rules/bare-exports.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(PKG_ROOT, "bin", "nm-style.mjs");
const TMP_ROOT = path.join(PKG_ROOT, "tmp-git-test");

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeRepo(name, files) {
  const repo = path.join(TMP_ROOT, name);
  fs.rmSync(repo, { recursive: true, force: true });
  fs.mkdirSync(repo, { recursive: true });
  git(["init", "-q"], repo);
  git(["config", "core.autocrlf", "false"], repo);
  git(["config", "user.email", "test@example.test"], repo);
  git(["config", "user.name", "tester"], repo);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  }
  git(["add", "."], repo);
  git(["commit", "-qm", "base"], repo);
  return repo;
}

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(prev);
  }
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
}

test("T-BA1 --changed：新增裸顶层 export function 报 BARE_EXPORT（阻断），既有行不报", () => {
  const repo = makeRepo("tba1-changed", { "packages/core/src/mod.ts": "export function alpha() {}\nfunction helper() {}\n" });
  try {
    fs.appendFileSync(path.join(repo, "packages/core/src/mod.ts"), "export function betaFresh() {}\n");
    withCwd(repo, () => {
      const findings = scanBareExports({ entries: [{ file: "packages/core/src/mod.ts", text: null }], changed: true, isAdded: addedLineFilter(true) });
      assert.deepEqual(findings.map((f) => `${f.symbol}@${f.line}`), ["betaFresh@3"]);
      assert.equal(findings[0].verdict, "BARE_EXPORT");
      assert.equal(findings[0].rule, "bare-exports");
      assert.equal(findings[0].blocking, true);
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T-BA2 HEAD 既有名不报：跨 hunk 重写的同名导出被 HEAD 兜底豁免，新名仍报", () => {
  const repo = makeRepo("tba2-head", { "packages/core/src/mod.ts": "export function alpha() {}\nfunction filler() {}\n" });
  try {
    // 把 alpha 挪到 filler 之后（跨 hunk 删加，git 不配对 → 行级视为新增），再追加一个全新导出。
    fs.writeFileSync(path.join(repo, "packages/core/src/mod.ts"), "function filler() {}\nexport function alpha() {}\nexport function gammaNew() {}\n");
    withCwd(repo, () => {
      const findings = scanBareExports({ entries: [{ file: "packages/core/src/mod.ts", text: null }], changed: true, isAdded: addedLineFilter(true) });
      assert.deepEqual(findings.map((f) => f.symbol), ["gammaNew"], `HEAD 已有的 alpha 应被兜底豁免，实际报出：${findings.map((f) => f.symbol).join(", ")}`);
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T-BA3 同名重载去重保留首行（全域口径，含计数模式）", () => {
  const text = "export function same(x: string): string;\nexport function same(x: string): string { return x; }\n";
  assert.deepEqual(bareExportsOf(text, false), [{ name: "same", line: 1 }]);
  const findings = scanBareExports({ entries: [{ file: "packages/core/src/overloads.ts", text }], changed: false, isAdded: () => true });
  assert.deepEqual(findings.map((f) => `${f.symbol}@${f.line}`), ["same@1"]);
  assert.equal(findings[0].blocking, false, "计数模式不阻断");
});

test("豁免链：.tsx PascalCase 组件、use* 钩子、keep-bare 前 3 行窗口（第 4 行起失效）", () => {
  const tsx = ["export function UserCard() {", "export function useThing() {", "export function use() {", "export function usefulHelper() {"].map((l) => `${l}}`).join("\n");
  assert.deepEqual(bareExportsOf(tsx, true).map((f) => f.name), ["usefulHelper"], "tsx 里 PascalCase 与 use* 豁免，usefulHelper 不是钩子");
  assert.deepEqual(bareExportsOf(tsx, false).map((f) => f.name), ["UserCard", "usefulHelper"], "非 tsx 只豁免 use*");
  const within = "// nm-style: keep-bare\nexport function within() {}\nexport function adjacent() {}\n// c\n// d\n// e\nexport function beyond() {}\n";
  assert.deepEqual(bareExportsOf(within, false).map((f) => f.name), ["beyond"], "keep-bare 豁免前 3 行窗口内的导出（within 与紧随其后的 adjacent 都在窗口内），隔了 4 行的 beyond 仍报");
});

test("域过滤：packages/<包>/src 与 apps/(desktop|mobile)/src 在域内，apps/cli、.d.ts、dist、test 不在", () => {
  assert.equal(isInBareDomain("packages/core/src/a/b.ts"), true);
  assert.equal(isInBareDomain("apps/mobile/src/web/view.tsx"), true);
  assert.equal(isInBareDomain("apps/desktop/src/main/x.ts"), true);
  assert.equal(isInBareDomain("apps/cli/src/run.ts"), false);
  assert.equal(isInBareDomain("apps/mobile/e2e/x.ts"), false);
  assert.equal(isInBareDomain("packages/core/src/types.d.ts"), false);
  assert.equal(isInBareDomain("packages/core/dist/out.js"), false);
  assert.equal(isInBareDomain("docs/notes.ts"), false);
});

test("CLI e2e：check --changed 报 BARE_EXPORT 且汇总 bare-exports=1；INFO 模式 bare-exports=INFO(n)", () => {
  // fixture 不放私有函数：hygiene 的 DEAD/FAKE_PUBLIC 会干扰 exit code 断言，本用例只盯 bare-exports 段。
  const repo = makeRepo("tba-cli", { "packages/core/src/mod.ts": "export function alpha() {}\n" });
  try {
    fs.appendFileSync(path.join(repo, "packages/core/src/mod.ts"), "export function betaFresh() {}\n");
    const changed = runCli(["check", "--changed"], repo);
    assert.equal(changed.status, 1);
    assert.ok(changed.stdout.includes("BARE_EXPORT"), "changed 模式应含 BARE_EXPORT 行");
    assert.ok(changed.stdout.includes("bare-exports=1"), `汇总应含 bare-exports=1，实际：${changed.stdout.split("\n").at(-2)}`);
    const info = runCli(["check", "packages/core/src"], repo);
    assert.equal(info.status, 0, "paths 模式 bare 段只计数不阻断（hygiene exported 面也不阻断）");
    assert.ok(info.stdout.includes("bare-exports=INFO(2)"), `paths 模式应 INFO(2)（alpha+betaFresh），实际：${info.stdout}`);
    assert.ok(info.stdout.includes("bare-exports=INFO"), "INFO 段存在");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
