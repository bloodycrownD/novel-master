// T-TA1~T-TA12：throw-audit——T1-T6 语句形态识别与属性列 / T7 转抛 helper 定义站点与 T8 调用站点
// （error-channel-debt §5，含断言豁免、keep、传递链）/ 判定矩阵五分支 / gate（未登记拦、UNTRIAGED 显数
// 不拦）/ write-baseline salvage；外加 CLI 用法错误（--write-baseline 与 --gate 互斥、gate 无基线 exit 2）。
// git 依赖用例在包内 gitignored 的 tmp-git-test/ 下构造（子目录名带 tta- 前缀），用完即删。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { throwSitesOfText, throwGateCompare, throwBaselinePayload, parseThrowBaseline } from "../dist/rules/throw-audit.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(PKG_ROOT, "bin", "nm-style.mjs");
const TMP_ROOT = path.join(PKG_ROOT, "tmp-git-test");

/** 判定矩阵 fixture：一条 throw 各覆盖一个 verdict 分支，行序即断言锚点。 */
const MATRIX_SRC = [
  "function t1Violation(x: unknown): Result<number, AppError> { if (!x.ok) throw x.error; return x; }",
  "function t4Boundary(n: number): number { try { return risky(n); } catch (e) { throw new Error(String(e)); } }",
  "function t4ViolationB(n: number | null): number { if (n == null) throw new Error('null'); return n; }",
  "async function t2AsyncResult(signal: AbortSignal): Promise<Result<void, AppError>> { throw createAbortError(signal); }",
  "class Repo {",
  "  save(n: number): Promise<void> { try { return this.conn.save(n); } catch (e) { throw new AppError('SAVE_FAILED', {detail: String(e)}); } }",
  "}",
  "function kept(n: number | null): void {",
  "  // nm-throw: keep — 第三方 SDK 边界：响应缺字段属服务端异常，由上层基础设施错误收口。",
  "  if (n == null) throw new Error('sdk null');",
  "}",
  "const arrowed = (n: number): Outcome<number> => { throw new AppError('X'); };",
  "function noAnnotation(n: number) { throw new Error('no-ret'); }",
  "function neverReturns(): never { throw new Error('never'); }",
  "async function promisePlain(): Promise<void> { throw new Error('pp'); }",
].join("\n");

const matrixSites = (file = "packages/core/src/matrix.ts") => throwSitesOfText(file, MATRIX_SRC);

test("T-TA1 T1-T6 语句形态识别与属性列（fn 路径 / ret 八值桶 / catch / keep 理由 / 稳定键）；never 标注函数并存 T7 定义站点", () => {
  const sites = matrixSites();
  assert.equal(sites.length, 11, "10 条语句站点 + neverReturns 的 T7 定义站点（error-channel-debt §5）");
  const [t1, t4b, t4v, t2, t3b, kept, t3o, t4n, t4never, t7never, t4pp] = sites;
  assert.equal(t1.form, "T1");
  assert.equal(t1.fn, "t1Violation");
  assert.equal(t1.ret, "result");
  assert.equal(t1.verdict, "VIOLATION");
  assert.equal(t4b.form, "T4");
  assert.equal(t4b.hasCatch, true);
  assert.equal(t4b.ret, "plain");
  assert.equal(t4b.verdict, "BOUNDARY");
  assert.equal(t4v.verdict, "VIOLATION-B");
  assert.equal(t2.form, "T2");
  assert.equal(t2.ret, "async-result");
  assert.equal(t2.verdict, "VIOLATION");
  assert.equal(t3b.form, "T3");
  assert.equal(t3b.fn, "Repo.save");
  assert.equal(t3b.ret, "promise-plain");
  assert.equal(t3b.verdict, "BOUNDARY");
  assert.equal(kept.verdict, "KEEP");
  assert.equal(kept.keep, "第三方 SDK 边界：响应缺字段属服务端异常，由上层基础设施错误收口。");
  assert.equal(t3o.fn, "arrowed");
  assert.equal(t3o.ret, "outcome");
  assert.equal(t3o.verdict, "VIOLATION");
  assert.equal(t4n.ret, "none");
  assert.equal(t4never.ret, "never");
  assert.equal(t4pp.ret, "promise-plain");
  assert.equal(t7never.form, "T7");
  assert.equal(t7never.text, "never-throw helper: neverReturns", "T7 键文本是合成文本，不与体内 T4 语句原文键碰撞");
  assert.equal(t7never.key, "packages/core/src/matrix.ts#never-throw helper: neverReturns");
  assert.equal(t7never.ret, "never");
  assert.equal(t7never.hasCatch, false);
  assert.equal(t7never.verdict, "VIOLATION-B");
  for (const site of sites) assert.ok(site.key.startsWith(site.file + "#"), "站点键 = 文件 # 语句原文");
  assert.equal(t1.text, "throw x.error;", "text 是 throw 语句本身（空白归一），不含同函数其余语句");
});

test("T-TA2 白名单：tdbc 驱动层 / 事务回调（文件名与 .transaction 回调实参 AST 判定）；控制信号白名单已随三类哨兵退役清空", () => {
  const tdbc = throwSitesOfText("packages/core/src/infra/tdbc/conn.ts", "function open(): void { throw new Error('open'); }")[0];
  assert.equal(tdbc.verdict, "ALLOWED");
  assert.equal(tdbc.allow, "tdbc-driver");
  const driverPkg = throwSitesOfText("packages/tdbc-driver-op-sqlite/src/connection.ts", "function run(): void { throw new Error('run'); }")[0];
  assert.equal(driverPkg.verdict, "ALLOWED");
  const txn = throwSitesOfText("packages/core/src/domain/x/logic/truncate-tail-in-transaction.ts", "function cut(t: unknown): void { if (t.kind === 'failed') throw t.error; }")[0];
  assert.equal(txn.verdict, "ALLOWED");
  assert.equal(txn.allow, "transaction");
  // error-matrix-final W5：三类控制流哨兵类退役（CoordinatedWriteRollback→INFRA_ROLLBACK_DEGRADED、
  // DatabaseReplaced→DB_BACKUP_REPLACE_INCOMPLETE、ChatPromptBuildBailed→null 哨兵），control-signal
  // 白名单清空——同名形态不再享豁免，按普通矩阵判（plain 无 catch → VIOLATION-B）。
  const signal = throwSitesOfText("apps/desktop/src/main/x.ts", "function sync(r: unknown): void { if (r.error instanceof DatabaseReplacedError) throw r.error; }")[0];
  assert.equal(signal.verdict, "VIOLATION-B", "control-signal 白名单已清空，退役类形态不再豁免");
  assert.equal(signal.allow, null);
  // 事务回调 AST 判定：文件名不带 in-transaction，throw 在 conn.transaction 回调内 → ALLOWED（总纲 §五例外 2）。
  const txnCallback = throwSitesOfText("packages/core/src/service/chat/impl/message.service.ts", "class S { async fork(conn: {transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>}): Promise<void> { const t = conn.transaction(async (tx) => { const v = await read(tx); if (v.kind === 'failed') throw v.error; return 1; }); await t; } }")[0];
  assert.equal(txnCallback.verdict, "ALLOWED", "conn.transaction 回调实参内的 throw 应按事务回滚放行");
  assert.equal(txnCallback.allow, "transaction");
  // 反例：同名变量调用别的（非 transaction）不吃事务豁免。
  const notTxn = throwSitesOfText("packages/core/src/service/chat/impl/message.service.ts", "class S { async fork(conn: {exec<T>(fn: (tx: unknown) => Promise<T>): Promise<T>}): Promise<void> { conn.exec(async (tx) => { const v = await read(tx); if (v.kind === 'failed') throw v.error; return 1; }); } }")[0];
  assert.equal(notTxn.verdict, "VIOLATION-B", "exec 回调不享事务豁免（只有 transaction 认抛错回滚）");
});

test("T-TA3 gate：未登记 VIOLATION/BOUNDARY 拦（exit 1），UNTRIAGED 不拦但显数，已消除=改善", () => {
  const sites = matrixSites();
  const baseline = { sites: {} };
  // 先全量入表：VIOLATION 类登记为 UNTRIAGED（欠账），BOUNDARY 类登记为 BOUNDARY（已登记）。
  for (const site of sites) baseline.sites[site.key] = { form: site.form, line: site.line, disposition: site.verdict === "BOUNDARY" ? "BOUNDARY" : "UNTRIAGED", reason: site.verdict === "BOUNDARY" ? "边界转码" : "" };
  let cmp = throwGateCompare(baseline, sites);
  assert.equal(cmp.blockers.length, 0, "全部登记后无拦截");
  assert.equal(cmp.untriaged.length, sites.filter((s) => s.verdict !== "BOUNDARY").length, "UNTRIAGED 显数");
  // 去掉一条 BOUNDARY 登记 → 未登记拦截。
  const boundarySite = sites.find((s) => s.verdict === "BOUNDARY");
  delete baseline.sites[boundarySite.key];
  cmp = throwGateCompare(baseline, sites);
  assert.equal(cmp.blockers.length, 1);
  assert.equal(cmp.blockers[0].key, boundarySite.key);
  // KEEP 缺理由进信息项。
  const keepSite = sites.find((s) => s.verdict === "KEEP");
  baseline.sites[keepSite.key] = { form: keepSite.form, line: keepSite.line, disposition: "KEEP", reason: "" };
  cmp = throwGateCompare(baseline, sites);
  assert.equal(cmp.keepWithoutReason.length, 0, "源码 keep 注释带理由，不报缺理由");
  // 基线里的键在当前扫描消失 → dropped（改善，不拦）。
  baseline.sites["packages/core/src/matrix.ts#throw new Error('gone');"] = { form: "T4", line: 99, disposition: "BOUNDARY", reason: "r" };
  cmp = throwGateCompare(baseline, sites);
  assert.equal(cmp.dropped.length, 1);
});

test("T-TA4 write-baseline：旧 disposition+reason 按 key salvage，新增站点按矩阵自动定性", () => {
  const sites = matrixSites();
  const keepSite = sites.find((s) => s.verdict === "KEEP");
  const old = parseThrowBaseline(JSON.stringify({ sites: { [keepSite.key]: { form: "T4", line: 1, disposition: "KEEP", reason: "人工理由" } } }));
  const payload = throwBaselinePayload(sites, old, "note", false);
  assert.equal(payload.sites[keepSite.key].reason, "人工理由", "salvage 保留人工理由");
  const violationSite = sites.find((s) => s.verdict === "VIOLATION");
  assert.equal(payload.sites[violationSite.key].disposition, "UNTRIAGED", "VIOLATION 新站点默认 UNTRIAGED 待人工定性");
  const boundarySite = sites.find((s) => s.verdict === "BOUNDARY");
  assert.equal(payload.sites[boundarySite.key].disposition, "UNTRIAGED", "BOUNDARY 新站点同样 UNTRIAGED（理由必须人工写）");
  const fresh = throwBaselinePayload(sites, null, "note", false);
  assert.equal(fresh.sites[keepSite.key].disposition, "KEEP", "无旧基线时 KEEP 按注释自动入表");
  // error-matrix-final W5：旧登记 BOUNDARY 但站点已落 keep 注释（当前 verdict=KEEP）→ disposition 刷新为 KEEP、人工理由保留。
  const oldBoundary = parseThrowBaseline(JSON.stringify({ sites: { [keepSite.key]: { form: "T4", line: 1, disposition: "BOUNDARY", reason: "旧人工定性" } } }));
  const refreshed = throwBaselinePayload(sites, oldBoundary, "note", false);
  assert.equal(refreshed.sites[keepSite.key].disposition, "KEEP", "当前机器判 KEEP，旧 BOUNDARY 登记刷新");
  assert.equal(refreshed.sites[keepSite.key].reason, "旧人工定性", "人工理由不被注释文案覆盖");
});

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

const REPO_SRC = {
  "packages/core/src/ok.ts": "function clean(): number { return 1; }\n",
  "apps/cli/src/skip.ts": "function cliThrow(): number { throw new Error('cli 不在扫描面'); }\n",
  "packages/core/test/x.test.ts": "function testThrow(): void { throw new Error('test 默认不扫'); }\n",
  "packages/core/src/throw.ts": "function leaky(x: unknown): number { if (!x.ok) throw x.error; return x; }\n",
};

test("T-TA5 CLI：write-baseline → gate 全绿；新增未登记 VIOLATION → exit 1；UNTRIAGED 显数", () => {
  const repo = makeRepo("tta-gate", REPO_SRC);
  const write = runCli(["throw-audit", "--write-baseline"], repo);
  assert.equal(write.status, 0, write.stderr);
  const baselinePath = path.join(repo, "scripts", "throw-audit-baseline.json");
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const keys = Object.keys(baseline.sites);
  assert.equal(keys.length, 1, "只收 packages+apps+tools 的 src 面（cli 与 test 排除）");
  assert.ok(keys[0].startsWith("packages/core/src/throw.ts#"));
  // 人工定性：leaky 改 UNTRIAGED → gate PASS 但显 UNTRIAGED=1。
  assert.equal(baseline.sites[keys[0]].disposition, "UNTRIAGED");
  let gate = runCli(["throw-audit", "--gate"], repo);
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.ok(gate.stdout.includes("UNTRIAGED=1"), "UNTRIAGED 强制显数");
  // 新增一个未登记 VIOLATION（返回 Result 的 unwrap throw）→ exit 1。
  fs.writeFileSync(path.join(repo, "packages/core/src/new.ts"), "function bad(x: unknown): Result<number, AppError> { if (!x.ok) throw x.error; return x; }\n");
  gate = runCli(["throw-audit", "--gate"], repo);
  assert.equal(gate.status, 1);
  assert.ok(gate.stdout.includes("new.ts"), "报出未登记站点位置");
  // salvage：给 leaky 补 reason 后重新 write，人工定性保留。
  baseline.sites[keys[0]].disposition = "UNTRIAGED";
  baseline.sites[keys[0]].reason = "人工欠账理由";
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
  const rewrite = runCli(["throw-audit", "--write-baseline"], repo);
  assert.equal(rewrite.status, 0, rewrite.stderr);
  const rewritten = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  assert.equal(rewritten.sites[keys[0]].reason, "人工欠账理由", "salvage 保留人工理由");
  fs.rmSync(repo, { recursive: true, force: true });
});

test("T-TA6 CLI 用法：--write-baseline 与 --gate 互斥 exit 2；gate 无基线 exit 2", () => {
  const repo = makeRepo("tta-usage", REPO_SRC);
  assert.equal(runCli(["throw-audit", "--write-baseline", "--gate"], repo).status, 2);
  assert.equal(runCli(["throw-audit", "--gate"], repo).status, 2);
  assert.equal(runCli(["throw-audit"], repo).status, 0, "默认全量表只出报告");
  fs.rmSync(repo, { recursive: true, force: true });
});

test("T-TA7 自定义错误类（T5）与再抛 / 其它表达式（T6）也进盘点，不再漏网；判定矩阵同口径", () => {
  const NL = String.fromCharCode(10);
  const src = [
    "function rethrow(e: unknown): void { throw e; }",
    "class TransportError extends Error { constructor(message: string, readonly raw: unknown) { super(message); } }",
    "async function send(): Promise<void> { throw new TransportError('bad', 1); }",
    "async function call(pick: boolean, a: Error, b: Error): Promise<void> { throw pick ? a : b; }",
    "function inResult(r: { ok: boolean; error?: Error }): Result<void, AppError> { if (!r.ok) throw r.error; return r as Result<void, AppError>; }",
  ].join(NL);
  const sites = throwSitesOfText("packages/core/src/ta7.ts", src);
  assert.deepEqual(sites.map((s) => s.form), ["T6", "T5", "T6", "T1"]);
  assert.deepEqual(sites.map((s) => s.verdict), ["VIOLATION-B", "VIOLATION-B", "VIOLATION-B", "VIOLATION"]);
  assert.equal(sites[1].text, "throw new TransportError('bad', 1);");
  assert.equal(sites[1].key, "packages/core/src/ta7.ts#throw new TransportError('bad', 1);");
});

// error-channel-debt §5：T7 转抛 helper 定义站点与 T8 调用站点（断言豁免 / keep / 传递链）。

test("T-TA8 T7 定义站点：MethodDeclaration 与 PropertyAssignment 箭头两形态都报，键取合成文本，与体内 T6 并存各占一键", () => {
  const src = [
    "const Helpers = {",
    "  raiseRunError(error: unknown): never { throw error; },",
    "  rethrow: (e: unknown): never => { throw e; },",
    "};",
  ].join("\n");
  const sites = throwSitesOfText("packages/core/src/ta8.ts", src);
  assert.deepEqual(sites.map((s) => [s.form, s.text, s.key]), [
    ["T6", "throw error;", "packages/core/src/ta8.ts#throw error;"],
    ["T7", "never-throw helper: raiseRunError", "packages/core/src/ta8.ts#never-throw helper: raiseRunError"],
    ["T6", "throw e;", "packages/core/src/ta8.ts#throw e;"],
    ["T7", "never-throw helper: rethrow", "packages/core/src/ta8.ts#never-throw helper: rethrow"],
  ]);
  assert.deepEqual(sites.filter((s) => s.form === "T6").map((s) => s.fn), ["raiseRunError", "rethrow"], "体内 T6 的 fn 列是 helper 方法名");
  for (const site of sites.filter((s) => s.form === "T7")) {
    assert.equal(site.ret, "never");
    assert.equal(site.hasCatch, false);
    assert.equal(site.verdict, "VIOLATION-B", "never helper 定义站点无 catch → VIOLATION-B（唯一修法是删 helper）");
    assert.equal(site.fn, "<module>", "对象字面量顶层定义 → <module>");
  }
});

test("T-TA9 T8 调用站点：裸调用与属性链调用都报且带 helper 名，键取调用原文（含实参），判定随所在函数", () => {
  const src = [
    "function boom(e: unknown): never { throw e; }",
    "const Runner = { boom(e: unknown): never { throw e; } };",
    "async function run(r: { ok: boolean; error: AppError }): Promise<Result<void, AppError>> {",
    "  if (!r.ok) boom(r.error);",
    "  if (!r.ok) Runner.boom(r.error);",
    "  return Result.ok(undefined);",
    "}",
  ].join("\n");
  const sites = throwSitesOfText("packages/core/src/ta9.ts", src);
  const t8s = sites.filter((s) => s.form === "T8");
  assert.deepEqual(t8s.map((s) => [s.helper, s.text, s.key]), [
    ["boom", "boom(r.error)", "packages/core/src/ta9.ts#boom(r.error)"],
    ["boom", "Runner.boom(r.error)", "packages/core/src/ta9.ts#Runner.boom(r.error)"],
  ]);
  for (const site of t8s) {
    assert.equal(site.ret, "async-result", "所在函数返回 Promise<Result> → async-result");
    assert.equal(site.verdict, "VIOLATION", "Result 函数内的 helper 调用 → VIOLATION（改 return）");
    assert.equal(site.fn, "run");
    assert.equal(site.hasCatch, false);
  }
});

test("T-TA10 断言豁免：assert 开头（大小写不敏感）与体内 throw new AssertionError 都不产生 T7/T8；豁免函数体内的语句站点照常", () => {
  const src = [
    "function assertNever(x: unknown): never { throw x; }",
    "function ASSERT_OK(x: unknown): never { throw x; }",
    "function die(x: unknown): never { throw new AssertionError('bad'); }",
    "function chainToAssert(x: unknown): never { return assertNever(x); }",
  ].join("\n");
  const sites = throwSitesOfText("packages/core/src/ta10.ts", src);
  assert.deepEqual(sites.filter((s) => s.form === "T7").map((s) => s.text), [], "豁免函数不产生 T7 定义站点");
  assert.deepEqual(sites.filter((s) => s.form === "T8").map((s) => s.text), [], "豁免函数（assertNever 不在名单）的调用不产生 T8");
  assert.deepEqual(sites.map((s) => s.form), ["T6", "T6", "T5"], "体内语句的 T1-T6 站点照常；chainToAssert 的 callee 不在名单 → 无站点");
});

test("T-TA11 keep 不豁免收集：体内注释与调用点注释都判 KEEP，站点照常入表", () => {
  const src = [
    "const Keep = {",
    "  kept(e: unknown): never {",
    "    // nm-throw: keep — 第三方 SDK 边界：由上层基础设施错误收口。",
    "    throw e;",
    "  },",
    "};",
    "async function run(r: { ok: boolean; error: AppError }): Promise<Result<void, AppError>> {",
    "  // nm-throw: keep — 调用点豁免。",
    "  if (!r.ok) Keep.kept(r.error);",
    "  return Result.ok(undefined);",
    "}",
  ].join("\n");
  const sites = throwSitesOfText("packages/core/src/ta11.ts", src);
  const t7 = sites.find((s) => s.form === "T7");
  const t8 = sites.find((s) => s.form === "T8");
  assert.equal(t7.verdict, "KEEP", "体内 throw 上方的 keep 注释 → KEEP");
  assert.equal(t7.keep, "第三方 SDK 边界：由上层基础设施错误收口。");
  assert.equal(t8.verdict, "KEEP", "调用点（外层 if 形态）上方的 keep 注释 → KEEP");
  assert.equal(t8.keep, "调用点豁免。");
  assert.equal(t8.helper, "kept");
});

test("T-TA12 传递链：体只 return 调用已知 T7 的候选随名单扩展（到不动点）也报 T7，体内调用照收 T8；callee 未知的不报", () => {
  const src = [
    "function leaf(e: unknown): never { throw e; }",
    "function mid(e: unknown): never { return leaf(e); }",
    "function top(e: unknown): never { return mid(e); }",
    "function isolated(e: unknown): never { return unknownThing(e); }",
  ].join("\n");
  const sites = throwSitesOfText("packages/core/src/ta12.ts", src);
  const t7s = sites.filter((s) => s.form === "T7");
  assert.deepEqual(t7s.map((s) => s.text), ["never-throw helper: leaf", "never-throw helper: mid", "never-throw helper: top"], "链上两层都随不动点入名单");
  const t8s = sites.filter((s) => s.form === "T8");
  assert.deepEqual(t8s.map((s) => [s.helper, s.text, s.fn]), [
    ["leaf", "leaf(e)", "mid"],
    ["mid", "mid(e)", "top"],
  ], "传递链体内的调用按 T8 收（helper 名指向链下一环）");
  assert.ok(!sites.some((s) => s.text.includes("isolated")), "callee 不在名单的候选不产生任何站点");
});
