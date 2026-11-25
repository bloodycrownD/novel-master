// T-RS1~T-RS5 + Step 4 验收：signatures 五类各一正一负；旧 test-check-signatures.mjs（62 行）用例语义
// 全量搬运（verdict 与断言不变，经 CLI --json 复现）；CLI 层端到端（paths / --changed / --range / --since /
// KFP 降级 INFO / 用法错误 exit 2）。git 依赖用例在包内 gitignored 的 tmp-git-test-sig/ 临时 git init 构造，
// 用完即删；五类单测用内存 scanText（blob text 直解析），不落盘。
// 依赖 dist 与 src 同步：跑本文件前先执行 node bin/nm-style.mjs --help（陈旧时自动重编译）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rangeScanInput, scanSignatures } from "../dist/rules/signatures.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(PKG_ROOT, "bin", "nm-style.mjs");
const TMP_ROOT = path.join(PKG_ROOT, "tmp-git-test-sig");

/** 旧 test-check-signatures.mjs 夹具逐行搬运（单参数/单实参/短 import/回调/长 import/const 与赋值拆行/负例）。 */
const OLD_FIXTURE = [
  "export function one(",
  "  x: string",
  "): string { return x; }",
  "one(",
  '  "x"',
  ");",
  "import {",
  "  one",
  '} from "./one.js";',
  "setTimeout(function () {",
  "  tick();",
  "}, 10);",
  "import {",
  "  aVeryLongNamedImport,",
  "  anotherVeryLongNamedImport,",
  '} from "./a-very-long-module-path-that-makes-the-one-line-import-exceed-print-width.js";',
  "const moved =",
  "  compute();",
  "const binary = a +",
  "  b;",
  "const object = {",
  "  a: 1,",
  "};",
  "const array = [",
  "  1,",
  "];",
  "const arrow = () =>",
  "  1;",
  "target =",
  "  value;",
  "",
];

/** 内存扫描：blob 直解析（不走磁盘），isAdded 全 true，位置相对当前 cwd。 */
function scanText(text) {
  return scanSignatures({ entries: [{ file: "fixture.ts", text }], isAdded: () => true });
}

/** JSX 语法用例专用：.tsx 后缀（.ts 下 JSX 解析不成立，豁免判定的 parent 链/体形态都会失真）。 */
function scanTextTsx(text) {
  return scanSignatures({ entries: [{ file: "fixture.tsx", text }], isAdded: () => true });
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
}

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

test("T-RS1 PARAMS：多行参数报（函数声明与箭头），单行参数不报", () => {
  const findings = scanText([
    "export function one(",
    "  x: string",
    "): string { return x; }",
    "const arrow = (",
    "  a: number",
    ") => a;",
    "export function ok(x: string): string { return x; }",
    "const fine = (a: number, b: number) => a + b;",
    "",
  ].join("\n"));
  const params = findings.filter((finding) => finding.verdict === "PARAMS");
  assert.deepEqual(params.map((finding) => finding.detail).sort(), ["arrow(1)", "one(1)"]);
  assert.ok(params.every((finding) => finding.blocking === true && finding.rule === "signatures"));
  assert.ok(!findings.some((finding) => finding.detail === "ok(1)" || finding.detail === "fine(2)"), "单行参数不得报");
});

test("T-RS2 ARGS：普通实参拆行报（相邻行即拆行，旧语义），回调实参与单行调用不报", () => {
  const findings = scanText([
    "foo(",
    '  "x",',
    "  2",
    ");",
    "setTimeout(function () {",
    "  tick();",
    "}, 10);",
    "mixed(function () {",
    "  tick();",
    "},",
    "  10,",
    "  20",
    ");",
    'ok("a", "b");',
    "",
  ].join("\n"));
  // mixed：回调跳过自身，其余普通实参仍按「调用写一行」校验（旧语义：普通实参相邻行即拆行）
  assert.deepEqual(findings.filter((finding) => finding.verdict === "ARGS").map((finding) => finding.detail), ["foo", "mixed"]);
  assert.ok(!findings.some((finding) => finding.detail === "ok" || finding.detail === "setTimeout"), "回调实参与相邻实参不得报");
});

test("T-RS3 IMPORT：1-3 个具名拆行报，长 import / 4+ 具名 / 单行不报", () => {
  const findings = scanText([
    "import {",
    "  one,",
    '} from "./one.js";',
    "import {",
    "  aVeryLongNamedImport,",
    "  anotherVeryLongNamedImport,",
    '} from "./a-very-long-module-path-that-makes-the-one-line-import-exceed-print-width.js";',
    "import {",
    "  a,",
    "  b,",
    "  c,",
    "  d,",
    '} from "./many.js";',
    'import { ok } from "./fine.js";',
    "",
  ].join("\n"));
  const imports = findings.filter((finding) => finding.verdict === "IMPORT");
  assert.deepEqual(imports.map((finding) => finding.detail), ["1 个具名导入"]);
  assert.equal(imports[0].symbol, '"./one.js"');
});

test("T-RS4 VARDECL：简单表达式拆行报，对象/数组/箭头块值与单行赋值不报", () => {
  const findings = scanText([
    "const moved =",
    "  compute();",
    "const binary = a +",
    "  b;",
    "const object = {",
    "  a: 1,",
    "};",
    "const array = [",
    "  1,",
    "];",
    "const arrow = () =>",
    "  1;",
    "const fine = compute();",
    "",
  ].join("\n"));
  assert.deepEqual(findings.filter((finding) => finding.verdict === "VARDECL").map((finding) => finding.detail).sort(), ["binary", "moved"]);
  assert.ok(!findings.some((finding) => ["object", "array", "arrow", "fine"].includes(finding.detail)), "块值与单行不得报");
});

test("T-RS5 ASSIGN：右侧简单表达式拆行报（含复合赋值），单行与块值不报", () => {
  const findings = scanText([
    "target =",
    "  value;",
    "done = ok;",
    "data = {",
    "  a: 1,",
    "};",
    "",
  ].join("\n"));
  assert.deepEqual(findings.filter((finding) => finding.verdict === "ASSIGN").map((finding) => finding.detail), ["target"]);
  // 旧 ts.isAssignmentExpression 运行时含复合赋值（d.ts 未声明该守卫，本地重建须同口径）
  const compound = scanText("total +=\n  1;\n");
  assert.deepEqual(compound.filter((finding) => finding.verdict === "ASSIGN").map((finding) => finding.detail), ["total"]);
});

test("旧用例语义全量搬运：五类计数与负例经 CLI --json 复现，exit 1", () => {
  const fixture = path.join(TMP_ROOT, `old-fixture-${process.pid}-${Date.now()}.ts`);
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  try {
    fs.writeFileSync(fixture, OLD_FIXTURE.join("\n"));
    const result = runCli(["check", fixture, "--json"], PKG_ROOT);
    assert.equal(result.status, 1);
    const rows = JSON.parse(result.stdout);
    const kinds = rows.map((row) => row.verdict);
    assert.equal(kinds.filter((kind) => kind === "PARAMS").length, 1);
    assert.equal(kinds.filter((kind) => kind === "ARGS").length, 1);
    assert.equal(kinds.filter((kind) => kind === "IMPORT").length, 1);
    assert.equal(kinds.filter((kind) => kind === "ASSIGN").length, 1);
    assert.deepEqual(rows.filter((row) => row.verdict === "VARDECL").map((row) => row.detail).sort(), ["binary", "moved"]);
    assert.ok(!kinds.includes("object"));
    assert.ok(!rows.some((row) => ["object", "array", "arrow"].includes(row.detail)));
    assert.ok(rows.every((row) => row.blocking === true), "无 KFP 命中时全部阻断");
  } finally {
    fs.rmSync(fixture, { force: true });
  }
});

test("CLI 端到端：文本模式汇总行（FINDINGS/PASS）与退出码", () => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const dirty = path.join(TMP_ROOT, `dirty-${process.pid}-${Date.now()}.ts`);
  const clean = path.join(TMP_ROOT, `clean-${process.pid}-${Date.now()}.ts`);
  try {
    fs.writeFileSync(dirty, OLD_FIXTURE.join("\n"));
    const failed = runCli(["check", dirty], PKG_ROOT);
    assert.equal(failed.status, 1);
    assert.ok(failed.stdout.includes("PARAMS") && failed.stdout.includes("VARDECL"), "阻断行进表格");
    // wave-4 起汇总行全实数：bare-exports/dup/oop 接入后，域外文件 INFO(0)、无基线仓 dup=无基线；p26 起透传 throw-audit=无基线。
    assert.ok(failed.stdout.includes("nm-style: FINDINGS（signatures=6 hygiene=0 top-let=0 ternary=0 bare-exports=INFO(0) dup=无基线 oop=INFO(0) throw-audit=无基线）"));
    fs.writeFileSync(clean, "export const ok = 1;\nexport function fine(a: string): string { return a; }\n");
    const passed = runCli(["check", clean], PKG_ROOT);
    assert.equal(passed.status, 0);
    assert.ok(passed.stdout.includes("nm-style: PASS（signatures=0 hygiene=0 top-let=0 ternary=0 bare-exports=INFO(0) dup=无基线 oop=INFO(0) throw-audit=无基线）"));
  } finally {
    fs.rmSync(dirty, { force: true });
    fs.rmSync(clean, { force: true });
  }
});

test("CLI 端到端：KFP 命中降级 INFO 不阻断（signatures 段 detail 包含 entry.symbol 匹配）", () => {
  const repo = path.join(TMP_ROOT, "kfp-e2e");
  const rel = path.join("packages", "core", "src", "domain", "abort", "logic", "create-abort-scope.ts");
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  try {
    fs.writeFileSync(path.join(repo, rel), [
      "export function run(signal: string, work: unknown, rejectWith: unknown, onCancel: unknown): void {",
      "  scope.raceWithCancel(",
      "    signal,",
      "    work,",
      "    rejectWith,",
      "    (fn) => onCancel(fn),",
      "  );",
      "}",
      "",
    ].join("\n"));
    const result = runCli(["check", rel], repo);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes("INFO") && result.stdout.includes("raceWithCancel") && result.stdout.includes("[rule-conflict]"), "命中行降级 INFO");
    assert.ok(!result.stdout.includes("ARGS"), "降级行不进阻断表格");
    assert.ok(result.stdout.includes("nm-style: PASS（signatures=0"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI 端到端：--changed 只报新增行，提交行（hunk 外）不报，未跟踪文件整文件报", () => {
  const repo = makeRepo("rs-changed", { "src/h.ts": "alpha\nconst moved =\n  compute();\n" });
  try {
    fs.writeFileSync(path.join(repo, "src/h.ts"), "alpha\nconst moved =\n  compute();\nconst other =\n  thing();\n");
    fs.writeFileSync(path.join(repo, "src/fresh.ts"), "export function gone(\n  x: string\n): string { return x; }\n");
    const result = runCli(["check", "--changed", "--json"], repo);
    assert.equal(result.status, 1);
    const details = JSON.parse(result.stdout).map((row) => row.detail);
    assert.deepEqual(details, ["gone(1)", "other"], "未跟踪文件整文件报，diff 新增行报，提交行不报");
    assert.ok(!details.includes("moved"), "提交行（hunk 外）不得报");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI 端到端：--changed 在非 git 目录给友好报错并 exit 2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nm-style-no-repo-"));
  try {
    const result = runCli(["check", "--changed"], dir);
    assert.equal(result.status, 2);
    assert.ok(result.stderr.includes("git 工作树"), "报错信息要说明需要 git 仓");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI 端到端：--changed 从子目录运行 fail loud（exit 2）——变更路径按 cwd 解析会静默扫 0 文件", () => {
  const repo = makeRepo("rs-changed-subdir", { "src/h.ts": "alpha\nconst moved =\n  compute();\n" });
  try {
    fs.writeFileSync(path.join(repo, "src/h.ts"), "alpha\nconst moved =\n  compute();\nconst other =\n  thing();\n");
    const result = runCli(["check", "--changed"], path.join(repo, "src"));
    assert.equal(result.status, 2);
    assert.ok(result.stderr.includes("仓根"), "报错信息要说明需从仓根运行");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("--range 规则层：读 range 右端 blob 且只报新增行，工作树漂移不影响结果", () => {
  const repo = makeRepo("rs-range", { "src/h.ts": "alpha\nconst moved =\n  compute();\n" });
  try {
    fs.writeFileSync(path.join(repo, "src/h.ts"), "alpha\nconst moved =\n  compute();\nconst other =\n  thing();\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "v2"], repo);
    fs.writeFileSync(path.join(repo, "src/h.ts"), "alpha\n"); // 工作树回退：扫描结果必须仍来自 blob
    withCwd(repo, () => {
      const results = scanSignatures(rangeScanInput("HEAD~1...HEAD", false));
      assert.deepEqual(results.map((finding) => `${finding.verdict} ${finding.detail}`), ["VARDECL other"], "v1 既有拆行（hunk 外）不报，v2 新增行报");
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI 端到端：--range/--since 扫描面 exit 1，--range 缺值 exit 2", () => {
  const repo = makeRepo("rs-range-cli", { "src/h.ts": "alpha\n" });
  try {
    fs.writeFileSync(path.join(repo, "src/h.ts"), "alpha\nconst moved =\n  compute();\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "v2"], repo);
    const range = runCli(["check", "--range", "HEAD~1...HEAD"], repo);
    assert.equal(range.status, 1);
    assert.ok(range.stdout.includes("VARDECL") && range.stdout.includes("moved"));
    assert.ok(range.stdout.includes("nm-style: FINDINGS（signatures=1"));
    const since = runCli(["check", "--since", "HEAD~1"], repo);
    assert.equal(since.status, 1);
    assert.ok(since.stdout.includes("nm-style: FINDINGS（signatures=1"));
    const malformed = runCli(["check", "--range"], repo);
    assert.equal(malformed.status, 2);
    assert.ok(malformed.stderr.includes("--range"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI 用法：缺省扫描面目录不存在（无参 / --all，cwd=包根无 packages/core/src）exit 2 且友好提示", () => {
  const bare = runCli(["check"], PKG_ROOT);
  assert.equal(bare.status, 2);
  assert.ok(bare.stderr.includes("缺省扫描面"));
  const allOnly = runCli(["check", "--all"], PKG_ROOT);
  assert.equal(allOnly.status, 2);
});

// ---------------------------------------------------------------------------
// p27 R5/R7：形态豁免（E1 hook / E2 JSX / E3 解构形参 / E4 宽度闸）与判据修正
// （M1 await 调用同口径 / M2 成员链实参前界基准）、R5 SQL 模板常量豁免。
// ---------------------------------------------------------------------------

test("p27 M1：await 调用 RHS 同行、调用体多行不报（与非 await call 同口径）；moved 仍报", () => {
  const findings = scanText([
    "async function f() {",
    "  const ok = await load({",
    "    a: 1,",
    "    b: 2,",
    "  });",
    "  const moved =",
    "    await load({ a: 1 });",
    "  return ok && moved;",
    "}",
  ].join("\n"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, "VARDECL");
  assert.equal(findings[0].symbol, "moved");
});

test("p27 M2：成员链实参紧跟调用点不报（基准取 method 名行）；直接调用的多实参拆行仍报", () => {
  const findings = scanText([
    "export function f(s: string) {",
    "  const chained = s",
    '    .replace(/a/g, "b")',
    '    .replace(/c/g, "d");',
    "  const direct = wrapper(",
    "    1,",
    "    2,",
    "  );",
    "  return chained + direct;",
    "}",
  ].join("\n"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, "ARGS");
  assert.equal(findings[0].symbol, "wrapper");
});

test("p27 E1：useXxx hook 实参拆行与 hook 声明 RHS 拆行豁免；非 hook 照报", () => {
  const findings = scanText([
    "function f() {",
    "  const [visible, setVisible] =",
    "    useState<string | null>(null);",
    "  const cache = useRef<Map<string, number>>(new Map([",
    '    ["a", 1],',
    "  ]));",
    "  const plain = compute(",
    "    1,",
    "  );",
    "  return visible + plain;",
    "}",
  ].join("\n"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, "ARGS");
  assert.equal(findings[0].symbol, "compute");
});

test("p27 E2：JSX 属性内的调用与 JSX 实参豁免；JSX 外同类调用照报", () => {
  const findings = scanTextTsx(
    [
      'const a = <div onClick={() => handleMultilineSubmitKeyDown(event, () => {',
      "  save();",
      "})} />;",
      'const b = <Portal>{createPortal(<div id="x" />, container)}</Portal>;',
      "const c = plainCall(",
      "  firstArg,",
      "  secondArg,",
      ");",
    ].join("\n")
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, "ARGS");
  assert.equal(findings[0].symbol, "plainCall");
});

test("p27 E3：hook 解构形参与组件 JSX 体的 props 解构豁免；纯逻辑函数解构形参照报", () => {
  // 注：首参即解构 `{` 与 function 同行，既有 split 判定天然不报（规则盲区）；
  // 命中形态是「第 2 参起解构」（renderer 唯一命中 useChatMessagesScrollFollow 即此形态），
  // 豁免与负例都用双参形态对拍。
  const findings = scanTextTsx([
    "function useChatScroll(",
    "  base: Session,",
    "  {",
    "    streamingText,",
    "    onSend,",
    "  }: ChatOptions",
    ") {",
    "  return onSend(streamingText);",
    "}",
    "function Panel(",
    "  { title, rows }: PanelProps",
    ") {",
    "  return <div>{title}{rows}</div>;",
    "}",
    "function plain(",
    "  base: string,",
    "  {",
    "    first,",
    "    second,",
    "  }: Pair",
    ") {",
    "  return first + second;",
    "}",
  ].join("\n"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, "PARAMS");
  assert.equal(findings[0].symbol, "plain");
});

test("p27 E4：非 call RHS 展平超 200 豁免（宽度闸）；moved 且 ≤200 照报；call RHS 不受闸影响", () => {
  const longText = "很长的中文文案".repeat(20);
  const findings = scanText([
    "function f(cond: boolean) {",
    `  const big = cond ? { message: "${longText}" } : { message: "${longText}" };`,
    "  const small =",
    "    cond ? { a: 1 } : { b: 2 };",
    "  return big && small;",
    "}",
  ].join("\n"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, "VARDECL");
  assert.equal(findings[0].symbol, "small");
});

test("p27 R5：全大写 *_SQL 模板常量豁免一行要求（单行/多行/等号换行均不报）；非 _SQL 模板照报", () => {
  const findings = scanText([
    "const AGG_SELECT_SQL = `SELECT",
    "  COUNT(*) AS calls,",
    "  SUM(prompt_tokens) AS prompt_tokens",
    "  FROM usage_record`;",
    "const INSERT_SQL =",
    "  `INSERT INTO usage_record (id) VALUES (#{id})`;",
    "const OTHER_TEMPLATE = `multi",
    "  line`;",
  ].join("\n"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, "VARDECL");
  assert.equal(findings[0].symbol, "OTHER_TEMPLATE");
});
