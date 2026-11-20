// T-LB1 / T-LB2：addedLineFilter 的 hunk 配对与 headExportFnNames 的 HEAD 同名导出兜底。
// 临时仓构造在包内 gitignored 的 tmp-git-test/ 下，用完即删；git 夹具行为均经实测（2026-11-20，git diff -U0）：
//   - 纯追加行 → 单 hunk 只含 + 行 → 报；
//   - 「移动」被 git 匹配（无编辑操作）→ 不出现在 diff → 不报；
//   - 行尾变化 → \r 剥离后同 hunk -x/+x 配对 → 不报；
//   - 跨 hunk 的同名删加（相邻交换）→ 不配对 → 报（旧注释明确的边界，bare-exports 段由 HEAD 兜底补位）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addedLineFilter, headExportFnNames } from "../dist/lib/git.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

function rawDiff(repo, rel) {
  return git(["diff", "HEAD", "-U0", "--", rel], repo);
}

test("T-LB1 addedLineFilter：纯新增行与未跟踪文件按新增报出", () => {
  const repo = makeRepo("lb1-add", { "src/add.ts": "alpha\nbeta\ngamma\n" });
  try {
    fs.writeFileSync(path.join(repo, "src/add.ts"), "alpha\nbeta\ngamma\ndelta\nepsilon\n");
    fs.writeFileSync(path.join(repo, "src/fresh.ts"), "hello\n");
    withCwd(repo, () => {
      const isAdded = addedLineFilter(true);
      const add = path.join(repo, "src/add.ts");
      assert.equal(isAdded(add, 1), false);
      assert.equal(isAdded(add, 3), false);
      assert.equal(isAdded(add, 4), true);
      assert.equal(isAdded(add, 5), true);
      const fresh = path.join(repo, "src/fresh.ts");
      assert.equal(isAdded(fresh, 1), true);
      assert.equal(isAdded(fresh, 99), true);
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T-LB1 addedLineFilter：被 git 匹配的移动行不报，真正新增的插入行仍报", () => {
  const repo = makeRepo("lb1-move", { "src/mv.ts": "alpha\nbeta\ngamma\n" });
  try {
    fs.writeFileSync(path.join(repo, "src/mv.ts"), "beta\nNEW_LINE\ngamma\n");
    assert.ok(rawDiff(repo, "src/mv.ts").includes("-alpha"), "夹具应产生 alpha 删除行");
    withCwd(repo, () => {
      const isAdded = addedLineFilter(true);
      const file = path.join(repo, "src/mv.ts");
      assert.equal(isAdded(file, 1), false); // beta 上移，git 按匹配处理，无 + 行
      assert.equal(isAdded(file, 2), true); // NEW_LINE 是真新增
      assert.equal(isAdded(file, 3), false);
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T-LB1 addedLineFilter：行尾变化归一化后同 hunk 配对不报，真新增行仍报", () => {
  const repo = makeRepo("lb1-eol", { "src/eol.ts": "alpha\nbeta\r\ngamma\n" });
  try {
    fs.writeFileSync(path.join(repo, "src/eol.ts"), "alpha\nbeta\ngamma\ndelta\n");
    const diff = rawDiff(repo, "src/eol.ts");
    assert.ok(diff.includes("-beta\r"), "夹具应产生带 \\r 的删除行");
    assert.ok(diff.includes("+beta"), "夹具应产生重加行");
    withCwd(repo, () => {
      const isAdded = addedLineFilter(true);
      const file = path.join(repo, "src/eol.ts");
      assert.equal(isAdded(file, 1), false);
      assert.equal(isAdded(file, 2), false); // \r 剥离后 -beta/+beta 同 hunk 配对
      assert.equal(isAdded(file, 3), false);
      assert.equal(isAdded(file, 4), true); // delta 是真新增
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T-LB1 addedLineFilter：变更全被配对吃掉的文件走「整文件新增」分支（旧实现边界，忠实保留）", () => {
  const repo = makeRepo("lb1-eol-only", { "src/pure.ts": "one\r\ntwo\r\n" });
  try {
    fs.writeFileSync(path.join(repo, "src/pure.ts"), "one\ntwo\n");
    const diff = rawDiff(repo, "src/pure.ts");
    assert.ok(diff.includes("-one\r") && diff.includes("+one"), "夹具应是纯行尾变化 diff");
    withCwd(repo, () => {
      const isAdded = addedLineFilter(true);
      const file = path.join(repo, "src/pure.ts");
      // 配对后无任何真新增 → 不进 addedLines，与未跟踪文件同分支：所有行按新增报
      assert.equal(isAdded(file, 1), true);
      assert.equal(isAdded(file, 2), true);
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T-LB1 addedLineFilter：跨 hunk 的同名删加不配对，按新增报（HEAD 兜底在 bare-exports 段补位）", () => {
  const repo = makeRepo("lb1-swap", { "src/swap.ts": "alpha\nbeta\ngamma\n" });
  try {
    fs.writeFileSync(path.join(repo, "src/swap.ts"), "beta\nalpha\ngamma\n");
    withCwd(repo, () => {
      const isAdded = addedLineFilter(true);
      const file = path.join(repo, "src/swap.ts");
      assert.equal(isAdded(file, 1), false); // beta 被 git 匹配到新位置
      assert.equal(isAdded(file, 2), true); // -alpha/+alpha 分居两 hunk，不配对
      assert.equal(isAdded(file, 3), false);
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T-LB2 headExportFnNames：HEAD 已有顶层导出名入集合（兜底生效），新增导出名不在集合", () => {
  const repo = makeRepo("lb2-head", { "src/h.ts": "export function foo() {}\nexport async function bar() {}\nfunction helper() {}\n" });
  try {
    fs.appendFileSync(path.join(repo, "src/h.ts"), "// touched\n"); // 触碰该文件但不新增导出名
    fs.writeFileSync(path.join(repo, "src/new-file.ts"), "export function gone() {}\n"); // 未提交的新文件
    withCwd(repo, () => {
      const names = headExportFnNames("src/h.ts");
      assert.ok(names != null);
      assert.ok(names.has("foo"));
      assert.ok(names.has("bar"));
      assert.ok(!names.has("helper"));
      // 工作区即便新增 qux 导出，HEAD 集合也不含它 → 不会被兜底（会被报）
      fs.appendFileSync(path.join(repo, "src/h.ts"), "export function qux() {}\n");
      assert.ok(!names.has("qux"));
      assert.equal(headExportFnNames("src/new-file.ts"), null); // 不在 HEAD → 不做豁免
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
