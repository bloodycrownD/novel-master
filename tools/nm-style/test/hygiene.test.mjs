// T-HY1~T-HY8（spec §七）+ object-binding 双向 + 旧 test-check-inline / test-check-methods /
// test-find-fake-exports 用例语义全量搬运（verdict 与断言意图不变，经新规则复现）；CLI 层端到端
// （hygiene 接线 / 缺省扫描面存在性报错 / --changed 行过滤 + 引用面恒全仓）。
// fixture 一律内存构造（多文件场景多 unit），不写 cwd；snapshot allowlist 与 git 仓用系统临时目录，用完即删。
// 依赖 dist 与 src 同步：跑本文件前先执行 node bin/nm-style.mjs --help（陈旧时自动重编译）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanHygiene } from "../dist/rules/hygiene.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(PKG_ROOT, "bin", "nm-style.mjs");

const unit = (file, text) => ({ file, text });

/** 内存扫描：entries=units（blob 直解析，不走磁盘），isAdded 全 true，mode 缺省 paths。 */
function scan(units, options = {}) {
  return scanHygiene({ entries: units.map((item) => ({ file: item.file, text: item.text })), units, isAdded: () => true, mode: options.mode ?? "paths", snapshotDir: options.snapshotDir });
}

const verdictOf = (findings, symbol) => findings.find((finding) => finding.symbol === symbol)?.verdict;

function runCli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeRepo(files) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "nm-style-hy-repo-"));
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

function withSnapshotDir(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nm-style-hy-snap-"));
  fs.writeFileSync(path.join(dir, "public.json"), JSON.stringify(content));
  return dir;
}

test("T-HY1 对象成员 DEAD：object-method / object-arrow 死成员必报（旧工具失明面），私有与导出容器两形态", () => {
  const findings = scan([
    unit("packages/demo/src/legacy.ts", "export const Legacy = { persist() {}, drain: () => {} };\nvoid Legacy;\n"),
    unit("packages/demo/src/inner.ts", "const Inner = { run() {} };\n"),
  ], { mode: "all" });
  const dead = findings.filter((finding) => finding.verdict === "DEAD");
  assert.deepEqual(dead.map((finding) => finding.symbol).sort(), ["Inner.run", "Legacy.drain", "Legacy.persist"]);
  assert.ok(dead.every((finding) => finding.blocking === true && finding.rule === "hygiene"));
  const bySymbol = new Map(dead.map((finding) => [finding.symbol, finding]));
  assert.equal(bySymbol.get("Legacy.persist").form, "object-method");
  assert.equal(bySymbol.get("Legacy.drain").form, "object-arrow");
  assert.equal(bySymbol.get("Legacy.persist").face, "exported");
  // 非导出 object 容器成员走 exported face（globalRefs 保守归因，cr-func-hygiene P0 修复后口径）。
  assert.equal(bySymbol.get("Inner.run").face, "exported");
});

test("P0 回归·工厂返回对象：成员经接收者变量跨文件消费不判 DEAD（cr-func-hygiene 复现 logger.ts 形态）", () => {
  const findings = scan([
    unit("packages/demo/src/logger.ts", "export function create() {\n  return { debug() {}, info() {} };\n}\n"),
    unit("packages/demo/src/app.ts", 'import { create } from "./logger";\nconst log = create();\nlog.debug();\nlog.info();\nlog.debug();\n'),
  ], { mode: "all" });
  const dead = findings.filter((finding) => finding.verdict === "DEAD");
  assert.ok(!dead.some((finding) => finding.symbol.startsWith("create.")), "经接收者变量消费的工厂对象成员不得判 DEAD");
  assert.ok(!findings.some((finding) => finding.symbol === "create.debug" && finding.verdict === "DEAD"));
});

test("P0 回归·数组元素对象：成员经迭代变量消费不判 DEAD（保守归因命中全部同名成员）", () => {
  const findings = scan([
    unit("packages/demo/src/handlers.ts", "export const handlers = [{ run() {} }, { stop() {} }];\n"),
    unit("packages/demo/src/loop.ts", 'import { handlers } from "./handlers";\nfor (const h of handlers) {\n  h.run();\n}\n'),
  ], { mode: "all" });
  const dead = findings.filter((finding) => finding.verdict === "DEAD");
  assert.ok(!dead.some((finding) => finding.symbol.endsWith(".run")), "run 经迭代变量 h.run() 消费，保守归因必须救回");
  assert.ok(dead.some((finding) => finding.symbol.endsWith(".stop")), "stop 全仓零消费仍判 DEAD");
});

test("T-HY2 对象成员单点 INLINE_CANDIDATE：一处消费者判内联，两点消费不报", () => {
  const findings = scan([
    unit("packages/demo/src/store.ts", "export const Store = { save() {}, once() {} };\nStore.save();\nStore.once();\nStore.once();\n"),
  ], { mode: "all" });
  const inline = findings.filter((finding) => finding.verdict === "INLINE_CANDIDATE");
  assert.deepEqual(inline.map((finding) => finding.symbol), ["Store.save"]);
  assert.equal(inline[0].face, "exported");
  assert.equal(inline[0].form, "object-method");
  assert.equal(inline[0].blocking, true);
  assert.ok(!findings.some((finding) => finding.symbol === "Store.once" && (finding.verdict === "INLINE_CANDIDATE" || finding.verdict === "DEAD")), "两点消费按健康导出处理");
});

test("T-HY3 导出面 TEST_ONLY：生产 0 消费、测试有引用", () => {
  const findings = scan([
    unit("packages/demo/src/feat.ts", "export function onlyTest(): void {}\n"),
    unit("packages/demo/test/feat.test.ts", 'import { onlyTest } from "../src/feat.js";\nonlyTest();\n'),
  ], { mode: "all" });
  const row = findings.find((finding) => finding.symbol === "onlyTest");
  assert.equal(row.verdict, "TEST_ONLY");
  assert.equal(row.face, "exported");
  assert.equal(row.blocking, true, "--all 下 exported 面 TEST_ONLY 阻断");
});

test("T-HY4 FAKE_PUBLIC × public snapshot allowlist：命中 allowlist 才判 FAKE_PUBLIC，未命中判 DEAD", () => {
  const snapshotDir = withSnapshotDir(["snapshotKept"]);
  try {
    const findings = scan([
      unit("packages/demo/src/door.ts", "export function snapshotKept(): void {}\nexport function plainDead(): void {}\n"),
    ], { mode: "all", snapshotDir });
    const fake = findings.find((finding) => finding.symbol === "snapshotKept");
    assert.equal(fake.verdict, "FAKE_PUBLIC");
    assert.equal(fake.blocking, true);
    assert.ok(fake.detail.includes("allowlist"), "detail 说明 allowlist 命中");
    assert.equal(verdictOf(findings, "plainDead"), "DEAD");
  } finally {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
});

test("T-HY5 AMBIGUOUS 短路：顶层同名多定义与成员同名多容器都不再判 DEAD/INLINE，且恒不阻断", () => {
  const findings = scan([
    unit("packages/demo/src/a.ts", "export function dupName(): void {}\n"),
    unit("packages/demo/src/b.ts", "export function dupName(): void {}\ndupName();\n"),
    unit("packages/demo/src/c.ts", "export const A = { hit(): void {} };\nexport const B = { hit(): void {} };\nA.hit();\n"),
  ], { mode: "all" });
  const ambiguous = findings.filter((finding) => finding.verdict === "AMBIGUOUS");
  assert.deepEqual(ambiguous.map((finding) => finding.symbol).sort(), ["A.hit", "B.hit", "dupName", "dupName"], "b.ts 有真实消费点仍被 AMBIGUOUS 短路");
  assert.ok(ambiguous.every((finding) => finding.blocking === false), "AMBIGUOUS 恒不阻断（spec §3.3）");
  assert.ok(!findings.some((finding) => finding.symbol === "dupName" && finding.verdict !== "AMBIGUOUS"), "dupName 不出第二行 verdict");
});

test("T-HY6 PASS_THROUGH：顶层私有与 class 方法两形态；private/class-public 阻断，exported 默认目录模式不阻断", () => {
  const findings = scan([
    unit("packages/demo/src/wrap.ts", [
      "declare function id(x: string): string;",
      "export function exportedWrap(x: string): string { return id(x); }",
      "function privateWrap(x: string): string { return id(x); }",
      "privateWrap('a');",
      "export class Wrapper {",
      "  pick(value: string): string { return value; }",
      "  wrap(value: string): string { return this.pick(value); }",
      "}",
      "new Wrapper().wrap('x');",
      "",
    ].join("\n")),
  ]);
  const pass = findings.filter((finding) => finding.verdict === "PASS_THROUGH");
  assert.deepEqual(pass.map((finding) => finding.symbol).sort(), ["Wrapper.wrap", "exportedWrap", "privateWrap"]);
  const bySymbol = new Map(pass.map((finding) => [finding.symbol, finding]));
  assert.equal(bySymbol.get("privateWrap").blocking, true, "私有面任何模式阻断");
  assert.equal(bySymbol.get("Wrapper.wrap").blocking, true, "class-public 面任何模式阻断");
  assert.equal(bySymbol.get("exportedWrap").blocking, false, "exported 面 paths 模式只报不阻断（旧脚本整段 exit 1 的口径由矩阵取代）");
});

test("T-HY7 阻断矩阵：exported 面 DEAD 在 paths 模式不阻断，strict/all/changed 全阻断", () => {
  const units = [unit("packages/demo/src/dead.ts", "export function lonelyExport(): void {}\n")];
  const pathsRow = scan(units, { mode: "paths" }).find((finding) => finding.symbol === "lonelyExport");
  assert.equal(pathsRow.verdict, "DEAD");
  assert.equal(pathsRow.blocking, false, "目录模式下 exported 面 DEAD 只报不阻断");
  for (const mode of ["strict", "all", "changed"]) {
    const row = scan(units, { mode }).find((finding) => finding.symbol === "lonelyExport");
    assert.equal(row.verdict, "DEAD");
    assert.equal(row.blocking, true, `mode=${mode} 应阻断`);
  }
});

test("T-HY8 deprecated 进 note 不吞判定：单点引用仍判 INLINE_CANDIDATE，零引用判 DEAD（旧「deprecated 优先」分支删除）", () => {
  const findings = scan([
    unit("packages/demo/src/legacy.ts", [
      "export class Api {",
      "  /** @deprecated 用 fresh */",
      "  single(): number { return 1; }",
      "  /** @deprecated 用 fresh */",
      "  gone(): number { return 2; }",
      "  fresh(): number { return 3; }",
      "}",
      "new Api().single();",
      "",
    ].join("\n")),
  ], { mode: "paths" });
  const single = findings.find((finding) => finding.symbol === "Api.single");
  assert.equal(single.verdict, "INLINE_CANDIDATE", "deprecated 不再优先于引用计数判定");
  assert.ok(single.detail.startsWith("已标 @deprecated；"), "deprecated 进 detail（note）");
  const gone = findings.find((finding) => finding.symbol === "Api.gone");
  assert.equal(gone.verdict, "DEAD", "零引用照常判死，只是 note 里带 @deprecated");
  assert.ok(gone.detail.includes("@deprecated"));
});

test("object-binding 双向：函数本体零裸名引用但经容器成员存活不判死；绑定无消费者才判死", () => {
  const findings = scan([
    unit("packages/demo/src/updater.ts", "function checkForUpdates(): void {}\nexport const Updater = { check: checkForUpdates };\n"),
    unit("packages/demo/src/use-updater.ts", 'import { Updater } from "./updater";\nUpdater.check();\n'),
    unit("packages/demo/src/bag.ts", "function orphanPack(): void {}\nexport const Bag = { carry: orphanPack };\n"),
  ], { mode: "all" });
  assert.ok(!findings.some((finding) => finding.symbol === "checkForUpdates"), "注册位不计消费：函数本体经容器成员存活，不判 DEAD/INLINE（机制级修复旧 KFP 假阳性）");
  const check = findings.find((finding) => finding.symbol === "Updater.check");
  assert.equal(check.form, "object-binding");
  assert.equal(check.verdict, "KEEP_PUBLIC", "成员注册不是可内联包装：单点消费按健康导出处理");
  const orphan = findings.find((finding) => finding.symbol === "orphanPack");
  assert.equal(orphan.verdict, "DEAD");
  assert.ok(orphan.detail.includes("绑定位不计消费"), "note 指出绑定位不计消费");
  assert.equal(verdictOf(findings, "Bag.carry"), "DEAD");
});

test("旧用例搬运（check-inline）：长函数 keep-local 保留；行数不是理由，小函数仍判内联", () => {
  const large = [
    "/** nm-style: keep-local — 管线阶段 */",
    "function large(): number {",
    "  let total = 0;",
    ...Array.from({ length: 22 }, (_, index) => `  total += ${index};`),
    "  return total;",
    "}",
    "export const value = large();",
    "",
  ].join("\n");
  const small = [
    "/** nm-style: keep-local — 不应豁免小函数 */",
    "function small(): number { return 1; }",
    "export const smallValue = small();",
    "",
  ].join("\n");
  const findings = scan([unit("packages/demo/src/large.ts", large), unit("packages/demo/src/small.ts", small)]);
  const largeRow = findings.find((finding) => finding.symbol === "large");
  assert.equal(largeRow.verdict, "KEEP_LOCAL");
  assert.equal(largeRow.blocking, false, "KEEP_LOCAL 恒不阻断");
  const smallRow = findings.find((finding) => finding.symbol === "small");
  assert.equal(smallRow.verdict, "INLINE_CANDIDATE", "keep-local 不豁免小函数（现行语义：单点引用且 >20 行）");
  assert.equal(smallRow.blocking, true);
});

test("旧用例搬运（check-inline）：f(x.trim()) 带简单参数变换的薄包装也判 PASS_THROUGH", () => {
  const findings = scan([
    unit("packages/demo/src/normalize.ts", [
      "declare function resolve(path: string): string;",
      "export function normalize(path: string): string {",
      "  return resolve(path.trim());",
      "}",
      "",
    ].join("\n")),
  ]);
  const row = findings.find((finding) => finding.symbol === "normalize");
  assert.equal(row.verdict, "PASS_THROUGH");
  assert.equal(row.face, "exported");
  assert.equal(row.blocking, false);
});

test("旧用例搬运（check-methods）：类内方法 dead / inline / pass-through / deprecated 全谱", () => {
  const findings = scan([
    unit("packages/demo/src/demo.ts", [
      "class Demo {",
      "  private unused(): void {}",
      "  private once(): void { this.used(); }",
      "  public used(): void { this.once(); }",
      "  public wrap(value: string): string { return this.pick(value); }",
      "  private pick(value: string): string { return value; }",
      "  /** @deprecated */",
      "  public legacyNeverCalledXyz(): void {}",
      "}",
      "new Demo().used();",
      "new Demo().wrap('x');",
      "",
    ].join("\n")),
  ], { mode: "paths" });
  assert.equal(verdictOf(findings, "Demo.unused"), "DEAD");
  assert.equal(verdictOf(findings, "Demo.once"), "INLINE_CANDIDATE");
  assert.equal(verdictOf(findings, "Demo.wrap"), "PASS_THROUGH");
  assert.equal(verdictOf(findings, "Demo.pick"), "INLINE_CANDIDATE");
  const legacy = findings.find((finding) => finding.symbol === "Demo.legacyNeverCalledXyz");
  assert.equal(legacy.verdict, "DEAD", "deprecated 不再产出独立的 DEPRECATED_DEAD verdict");
  assert.ok(legacy.detail.includes("@deprecated"));
  assert.ok(!findings.some((finding) => finding.symbol === "Demo.used"), "两点消费不报");
});

test("旧用例搬运（find-fake-exports）：经 barrel 的调用点 / 测试引用 / keep-public 豁免语义", () => {
  const snapshotDir = withSnapshotDir(["publicOne", "keptPublic"]);
  try {
    const findings = scan([
      unit("packages/demo/src/defs.ts", [
        "export function oneCall(): void {}",
        "export function twoCalls(): void {}",
        "export function deadCall(): void {}",
        "export function publicOne(): void {}",
        "/** nm-style: keep-public — 跨层唯一入口 fixture */",
        "export function keptPublic(): void {}",
        "export type DeadType = string;",
        "",
      ].join("\n")),
      unit("packages/demo/src/barrel.ts", [
        'export { oneCall, twoCalls, deadCall, publicOne, keptPublic } from "./defs.js";',
        'export type { DeadType } from "./defs.js";',
        "",
      ].join("\n")),
      unit("packages/demo/src/consumer.ts", [
        'import { oneCall, twoCalls, publicOne, keptPublic, type DeadType } from "./barrel.js";',
        'const typed: DeadType = "x";',
        "oneCall();",
        "twoCalls();",
        "twoCalls();",
        "publicOne();",
        "keptPublic();",
        "void typed;",
        "",
      ].join("\n")),
      unit("packages/demo/test/consumer.test.ts", [
        'import { deadCall } from "../src/barrel.js";',
        "deadCall();",
        "",
      ].join("\n")),
    ], { mode: "paths", snapshotDir });
    assert.equal(verdictOf(findings, "oneCall"), "INLINE_CANDIDATE", "经 barrel 的单点调用仍归因到定义（import 感知）");
    assert.equal(verdictOf(findings, "twoCalls"), "KEEP_PUBLIC");
    assert.equal(verdictOf(findings, "deadCall"), "TEST_ONLY", "生产 0 消费、测试引用");
    assert.equal(verdictOf(findings, "publicOne"), "INLINE_CANDIDATE", "allowlist 命中但生产有单点消费：仍判内联（旧语义）");
    assert.equal(verdictOf(findings, "keptPublic"), "KEEP_PUBLIC", "keep-public 在单点消费分支同样救援（旧 keepPublicOf 三别名全算）");
    assert.equal(verdictOf(findings, "DeadType"), undefined, "新口径边界：类型别名不在八值 form 收集面（spec §3.2），不再产出 DeadType 行");
  } finally {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
});

test("CLI 端到端：hygiene 接线——JSON 行带 face/form，非阻断行不进 hygiene 计数，缺省扫描面缺失报错 exit 2", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "nm-style-hy-cli-"));
  try {
    fs.mkdirSync(path.join(repo, "packages/demo/src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "packages/demo/src/demo.ts"), [
      "export const Store = { persist(): void {} };",
      "function helper(x: string): string { return x; }",
      "helper('a');",
      "helper('b');",
      "Store.persist();",
      "",
    ].join("\n"));
    const ok = runCli(["check", "packages/demo/src/demo.ts", "--json"], repo);
    assert.equal(ok.status, 0, "persist 是 exported 面 paths 模式 → 只报不阻断");
    const rows = JSON.parse(ok.stdout);
    const persist = rows.find((row) => row.symbol === "Store.persist");
    assert.equal(persist.verdict, "INLINE_CANDIDATE");
    assert.equal(persist.face, "exported");
    assert.equal(persist.form, "object-method");
    assert.equal(persist.blocking, false);
    assert.ok(rows.some((row) => row.rule === "hygiene"), "hygiene 行进了 JSON 输出");
    const text = runCli(["check", "packages/demo/src/demo.ts"], repo);
    assert.ok(text.stdout.includes("nm-style: PASS（signatures=0 hygiene=0"), "非阻断行不进 hygiene 阻断计数");
    assert.ok(text.stdout.includes("Store.persist"), "信息行进表格");
    const missing = runCli(["check"], repo);
    assert.equal(missing.status, 2);
    assert.ok(missing.stderr.includes("缺省扫描面"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI 端到端：--changed 行过滤 + 引用面恒全仓——唯一消费点在未改动文件时仍判 INLINE_CANDIDATE，未改动文件的死代码不报", () => {
  const repo = makeRepo({
    "packages/demo/src/consumer.ts": 'import { freshFn } from "./fresh.js";\nexport function runConsumer(): void { freshFn(); }\n',
    "packages/demo/src/dead.ts": "export function staleDead(): void {}\n",
  });
  try {
    fs.writeFileSync(path.join(repo, "packages/demo/src/fresh.ts"), "export function freshFn(): void {}\n");
    const result = runCli(["check", "--changed", "--json"], repo);
    assert.equal(result.status, 1);
    const rows = JSON.parse(result.stdout);
    const inline = rows.find((row) => row.symbol === "freshFn");
    assert.equal(inline.verdict, "INLINE_CANDIDATE", "消费点在未改动的既有文件——引用面恒全仓（spec Step 5）");
    assert.equal(inline.blocking, true, "--changed 下 exported 面 INLINE_CANDIDATE 阻断");
    assert.ok(!rows.some((row) => row.symbol === "staleDead"), "未改动文件不进扫描面");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
