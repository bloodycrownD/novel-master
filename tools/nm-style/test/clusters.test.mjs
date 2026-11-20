// T-CL1~T-CL2：gate bare 基线比对（CLI 全链路）+ list bare --summary/--bucket/--json + list clusters --all
// 四视图结构断言。git 依赖用例在包内 gitignored 的 tmp-git-test/ 下构造（子目录名带 tcl- 前缀），用完即删。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderClusters, viewByFile, viewLongNames, viewModifiers, viewSubjectFamilies } from "../dist/rules/clusters.js";
import { bucketOf } from "../dist/rules/bare-exports.js";

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

function runCli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
}

const CLUSTER_FILES = {
  "packages/core/src/domain/vfs/files.ts": "export function readEntry(path: string): string { return path; }\nexport function writeEntry(path: string, data: string): void {}\nexport function markEntryForTests(path: string): void {}\nexport function labelEntryForTests(path: string): void {}\nexport function copyEntryForTests(path: string): void {}\n",
};

test("T-CL1 gate bare 基线比对：写基线 → PASS → 新增裸导出 exit 1", () => {
  const repo = makeRepo("tcl-gate", CLUSTER_FILES);
  try {
    const write = runCli(["baseline", "write", "bare", "--baseline", "scripts/bare-exports-baseline.json"], repo);
    assert.equal(write.status, 0, `write 应成功：${write.stderr}`);
    assert.ok(write.stdout.includes("已写基线：1 文件 / 5 函数"));
    const payload = JSON.parse(fs.readFileSync(path.join(repo, "scripts/bare-exports-baseline.json"), "utf8"));
    assert.equal(payload.toolVersion, "0.1.0");
    assert.deepEqual(payload.files["packages/core/src/domain/vfs/files.ts"].sort(), ["copyEntryForTests", "labelEntryForTests", "markEntryForTests", "readEntry", "writeEntry"]);
    const clean = runCli(["gate", "bare"], repo);
    assert.equal(clean.status, 0, `基线 1→1 应 PASS：${clean.stdout}`);
    assert.ok(clean.stdout.includes("bare-exports: PASS（无新增裸导出）"));
    fs.mkdirSync(path.join(repo, "packages/core/src/domain/vfs"), { recursive: true });
    fs.writeFileSync(path.join(repo, "packages/core/src/domain/vfs/more.ts"), "export function extraBare() {}\n");
    const added = runCli(["gate", "bare"], repo);
    assert.equal(added.status, 1, `新增裸导出文件应 FIND：${added.stdout}`);
    assert.ok(added.stdout.includes("新增文件 1"));
    assert.ok(added.stdout.includes("[新增裸导出文件]"));
    assert.ok(added.stdout.includes("extraBare"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T-CL1 list bare：--summary TOTAL 行 / --bucket 桶清单 / --json totals", () => {
  const repo = makeRepo("tcl-list", CLUSTER_FILES);
  try {
    const summary = runCli(["list", "bare", "--summary"], repo);
    assert.equal(summary.status, 0);
    assert.ok(summary.stdout.includes("1 个文件 / 5 个函数"));
    assert.ok(summary.stdout.includes("core/domain/vfs"), "summary 应含桶行");
    assert.ok(summary.stdout.includes("TOTAL"), "summary 应含 TOTAL 行");
    const bucket = runCli(["list", "bare", "--bucket", "core/domain/vfs"], repo);
    assert.equal(bucket.status, 0);
    assert.ok(bucket.stdout.includes("packages/core/src/domain/vfs/files.ts"));
    const empty = runCli(["list", "bare", "--bucket", "core/none"], repo);
    assert.equal(empty.status, 0);
    assert.ok(empty.stdout.includes("该桶没有裸导出"));
    const json = runCli(["list", "bare", "--json"], repo);
    assert.equal(json.status, 0);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.totals.files, 1);
    assert.equal(parsed.totals.functions, 5);
    assert.equal(parsed.files[0].file, "packages/core/src/domain/vfs/files.ts");
    assert.deepEqual(parsed.files[0].functions, ["readEntry", "writeEntry", "markEntryForTests", "labelEntryForTests", "copyEntryForTests"], "--json 的 functions 按行序（与旧脚本一致；排序只发生在基线 files map）");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T-CL2 四视图结构：同主体族（≥3 动词）/ 修饰词复读（≥3 次）/ 长名榜 / 裸函数榜", () => {
  const entries = [
    {
      file: "packages/core/src/domain/session/store.ts",
      bucket: "core/domain/session",
      functions: [
        { name: "getSession", line: 1 },
        { name: "setSession", line: 5 },
        { name: "deleteSession", line: 9 },
        { name: "flushSessionForTests", line: 12 },
        { name: "markSessionForTests", line: 13 },
        { name: "labelSessionForTests", line: 14 },
        { name: "aVeryLongFunctionNameThatExceedsThirtyTwoChars", line: 20 },
      ],
    },
    { file: "packages/core/src/domain/vfs/files.ts", bucket: "core/domain/vfs", functions: [{ name: "readEntry", line: 1 }, { name: "writeEntry", line: 2 }] },
  ];
  const families = viewSubjectFamilies(entries);
  assert.equal(families.length, 1, "Session 族成立；readEntry/writeEntry 两动词不成族");
  assert.equal(families[0].subject, "Session");
  assert.equal(families[0].dir, "packages/core/src/domain/session");
  // flushSessionForTests / markSessionForTests / labelSessionForTests 剥掉 ForTests 后主体同为 Session，也计入动词。
  assert.deepEqual([...new Set(families[0].members.map((m) => m.verb))].sort(), ["delete", "flush", "get", "label", "mark", "set"]);
  const mods = viewModifiers(entries);
  assert.deepEqual(mods.map(([mod]) => mod), ["ForTests"]);
  assert.equal(mods[0][1].length, 3);
  const longs = viewLongNames(entries);
  assert.deepEqual(longs.map((f) => f.name), ["aVeryLongFunctionNameThatExceedsThirtyTwoChars"]);
  assert.ok(longs[0].name.length >= 32);
  const byFile = viewByFile(entries);
  assert.deepEqual(byFile.map((e) => e.file), [entries[0].file, entries[1].file], "按函数数降序");
  assert.equal(bucketOf("packages/core/src/domain/vfs/files.ts"), "core/domain/vfs");
  assert.equal(bucketOf("apps/mobile/src/web/view.ts"), "mobile/src/web");
  assert.equal(bucketOf("packages/llm-sse-native/src/impl/x.ts"), "packages/llm-sse-native");
  const rendered = renderClusters(entries);
  for (const header of ["== ① 同主体族", "== ② 修饰词复读", "== ③ 长名榜", "== ④ 裸函数榜"]) assert.ok(rendered.includes(header), `缺视图：${header}`);
});

test("T-CL2 CLI：list clusters --all 输出四视图（--json 给结构化视图）", () => {
  const repo = makeRepo("tcl-clusters", CLUSTER_FILES);
  try {
    const all = runCli(["list", "clusters", "--all"], repo);
    assert.equal(all.status, 0);
    assert.ok(all.stdout.includes("== ① 同主体族"));
    assert.ok(all.stdout.includes("== ② 修饰词复读"));
    assert.ok(all.stdout.includes("== ③ 长名榜"));
    assert.ok(all.stdout.includes("== ④ 裸函数榜"));
    const json = runCli(["list", "clusters", "--all", "--json"], repo);
    assert.equal(json.status, 0);
    const parsed = JSON.parse(json.stdout);
    assert.ok(Array.isArray(parsed.subjects) && Array.isArray(parsed.modifiers) && Array.isArray(parsed.longNames) && Array.isArray(parsed.byFile));
    const missingAll = runCli(["list", "clusters"], repo);
    assert.equal(missingAll.status, 2, "list clusters 缺 --all → 用法错误 exit 2");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
