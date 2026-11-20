// T-DU1~T-DU3：dup gate——新增键 exit 1 / 消除键不阻断 / v2 schema + judged salvage；
// 外加收集口径单测（全递归含嵌套函数、class 方法、非 src 剔除）与 CLI 用法错误。
// git 依赖用例在包内 gitignored 的 tmp-git-test/ 下构造（子目录名带 tdu- 前缀），用完即删。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dupRecordsOfText, groupDupRecords, salvageJudged } from "../dist/rules/dup.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(PKG_ROOT, "bin", "nm-style.mjs");
const TMP_ROOT = path.join(PKG_ROOT, "tmp-git-test");

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** 建仓：文件就位 + git add（dup 扫描走 git ls-files——tracked/index 口径，未跟踪不可见）。 */
function makeRepo(name, files, commit = true) {
  const repo = path.join(TMP_ROOT, name);
  fs.rmSync(repo, { recursive: true, force: true });
  fs.mkdirSync(repo, { recursive: true });
  git(["init", "-q"], repo);
  git(["config", "core.autocrlf", "false"], repo);
  git(["config", "user.email", "test@example.test"], repo);
  git(["config", "user.name", "tester"], repo);
  writeFiles(repo, files);
  git(["add", "."], repo);
  if (commit) git(["commit", "-qm", "base"], repo);
  return repo;
}

function writeFiles(repo, files) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  }
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
}

/** 双文件双形态 fixture：sharedUtil 成同名组，alphaOne/betaTwo 与 sharedUtil 对成同形态组。 */
const DUP_FILES = {
  "packages/core/src/one.ts": "function sharedUtil(x: string): string { return x; }\nfunction alphaOne(count: number, name: string): void {}\n",
  "packages/core/src/two.ts": "function sharedUtil(x: string): string { return x; }\nfunction betaTwo(count: number, name: string): void {}\n",
};

test("收集口径：全递归含嵌套具名函数与 class 方法，分组键与旧脚本一致", () => {
  const records = [
    ...dupRecordsOfText("packages/core/src/a.ts", "function makeHandler() {\n  function process(evt: string): string { return evt; }\n  return { process };\n}\nclass Repo {\n  save(x: number): void {}\n  #secret() {}\n}\nconst arrow = (n: number) => n;\n"),
    ...dupRecordsOfText("packages/core/src/b.ts", "function makeHandler() {\n  function process(evt: string): string { return evt; }\n  return { process };\n}\nclass Repo {\n  save(x: number): void {}\n}\n"),
  ];
  const groups = groupDupRecords(records);
  assert.ok(groups.named["process"] != null, "嵌套具名函数应入组（旧全递归口径，收窄会让组静默消失）");
  assert.equal(groups.named["process"].length, 2);
  assert.ok(groups.named["Repo.save"] != null, "class 方法以 ClassName.method 入组");
  assert.ok(groups.named["arrow"] == null, "单点符号不成组");
  const shapeOf = (name) => records.find((r) => r.name === name).shapeKey;
  assert.equal(shapeOf("process"), "(: string)", "shapeKey 剥参数名只留类型形态");
  assert.equal(shapeOf("Repo.save"), "(: number)");
});

test("非 /src/ 记录不参与门禁分组（测试 helper 的自包含重复是刻意设计）", () => {
  const records = [
    ...dupRecordsOfText("packages/core/src/a.ts", "function sharedUtil(x: string): string { return x; }\n"),
    ...dupRecordsOfText("packages/core/test/shared-util.test.ts", "function sharedUtil(x: string): string { return x; }\n"),
  ];
  const groups = groupDupRecords(records);
  assert.ok(groups.named["sharedUtil"] == null, "test 侧站点混入会让整组被剔除（every(isSrc)）");
});

test("T-DU3 salvageJudged：P17→P18→v2 三层并入（后写覆盖），键消失进 dropped", () => {
  const current = { named: { keptName: ["a.ts:1", "b.ts:1"] }, shaped: { "(: string)": ["a.ts:1", "b.ts:2"] } };
  const old = {
    judgedAfterP17: { named: { keptName: "r1", goneName: "r2" }, shaped: { "(: string)": "r3" } },
    judgedAfterP18: { named: { keptName: "r4（覆盖 r1）" } },
    judged: { named: { keptName: "v2（覆盖 r4）" } },
  };
  const { judged, dropped } = salvageJudged(old, current);
  assert.equal(judged.named.keptName, "v2（覆盖 r4）", "v2 judged 最后覆盖");
  assert.equal(judged.shaped["(: string)"], "r3");
  assert.deepEqual(dropped.map((d) => `${d.section}:${d.key}`), ["named:goneName"]);
  const empty = salvageJudged({}, current);
  assert.deepEqual(empty.judged, { named: {}, shaped: {} });
  assert.deepEqual(empty.dropped, []);
});

test("T-DU1 gate 新增键 exit 1（基线快照后加新重复对），消除键不阻断（T-DU2）", () => {
  const repo = makeRepo("tdu-gate", DUP_FILES);
  try {
    const write = runCli(["baseline", "write", "dup", "--baseline", "scripts/dup-signatures-baseline.json"], repo);
    assert.equal(write.status, 0, `baseline write 应成功：${write.stderr}`);
    const payload = JSON.parse(fs.readFileSync(path.join(repo, "scripts/dup-signatures-baseline.json"), "utf8"));
    assert.equal(payload.toolVersion, "0.1.0", "v2 schema 必含 toolVersion");
    assert.equal(typeof payload.generatedAt, "string");
    assert.ok(payload.judged != null && payload.judged.named != null && payload.judged.shaped != null, "v2 schema 必含 judged 段");
    assert.ok(payload.namedGroups >= 1 && payload.shapedGroups >= 2);
    const clean = runCli(["gate", "dup"], repo);
    assert.equal(clean.status, 0, `无新增应 PASS：${clean.stdout}`);
    assert.ok(clean.stdout.includes("dup-signatures: PASS"));
    // T-DU2：消除一个既有同名键 → 不阻断，报消除计数。
    fs.writeFileSync(path.join(repo, "packages/core/src/two.ts"), "function sharedUtilRenamed(x: string): string { return x; }\nfunction betaTwo(count: number, name: string): void {}\n");
    const gone = runCli(["gate", "dup"], repo);
    assert.equal(gone.status, 0, `消除键不应阻断：${gone.stdout}`);
    assert.ok(gone.stdout.includes("消除 1"));
    assert.ok(gone.stdout.includes("sharedUtil"), "消除清单应列出被消除的键");
    // T-DU1：新增一个基线里没有的同名对 → exit 1 并列出站点。
    writeFiles(repo, {
      "packages/core/src/three.ts": "function freshPair(x: number): void {}\n",
      "packages/core/src/four.ts": "function freshPair(x: number): void {}\n",
    });
    git(["add", "."], repo);
    const added = runCli(["gate", "dup"], repo);
    assert.equal(added.status, 1, `新增同名组应 FIND：${added.stdout}`);
    assert.ok(added.stdout.includes("[新增同名重复]"));
    assert.ok(added.stdout.includes("freshPair"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T-DU3 salvage：v1 旧文件（judgedAfterP17/P18）write 时并入 judged，消失键警告到 stderr", () => {
  const repo = makeRepo("tdu-salvage", DUP_FILES);
  try {
    const oldBaseline = {
      note: "v1 旧态（含人工裁决）",
      namedGroups: 1,
      shapedGroups: 2,
      named: { sharedUtil: ["packages/core/src/one.ts:1", "packages/core/src/two.ts:1"] },
      shaped: { "(: string)": ["x"], "(: number, : string)": ["y"] },
      judgedAfterP17: { named: { sharedUtil: "双端镜像 r1", judgedGone: "已被消除的裁决 r2" }, shaped: { "(: string)": "刻意重复 r3" } },
      judgedAfterP18: { named: { sharedUtil: "十八期更新理由 r4" } },
    };
    fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repo, "scripts/dup-signatures-baseline.json"), JSON.stringify(oldBaseline, null, 2));
    const write = runCli(["baseline", "write", "dup", "--baseline", "scripts/dup-signatures-baseline.json"], repo);
    assert.equal(write.status, 0, `write 应成功：${write.stderr}`);
    assert.ok(write.stderr.includes("judgedGone") && write.stderr.includes("已不在当前扫描"), `消失键应警告：${write.stderr}`);
    const payload = JSON.parse(fs.readFileSync(path.join(repo, "scripts/dup-signatures-baseline.json"), "utf8"));
    assert.equal(payload.toolVersion, "0.1.0");
    assert.equal(payload.judged.named.sharedUtil, "十八期更新理由 r4", "P18 覆盖 P17 后照搬");
    assert.equal(payload.judged.shaped["(: string)"], "刻意重复 r3");
    assert.ok(!("judgedGone" in payload.judged.named), "消失键不进新基线");
    assert.ok(payload.namedGroups >= 1, "named/shaped 机械重生成");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI 用法错误：baseline write 缺 --baseline exit 2；gate 指向不存在基线 exit 2", () => {
  const repo = makeRepo("tdu-usage", DUP_FILES);
  try {
    const noBaseline = runCli(["baseline", "write", "dup"], repo);
    assert.equal(noBaseline.status, 2);
    assert.ok(noBaseline.stderr.includes("必须显式 --baseline"));
    const missingGate = runCli(["gate", "dup", "--baseline", "scripts/no-such-baseline.json"], repo);
    assert.equal(missingGate.status, 2);
    assert.ok(missingGate.stderr.includes("基线不存在"));
    const badTarget = runCli(["baseline", "write", "foo", "--baseline", "x.json"], repo);
    assert.equal(badTarget.status, 2);
    const bareGateMissing = runCli(["gate", "bare"], repo);
    assert.equal(bareGateMissing.status, 2);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
