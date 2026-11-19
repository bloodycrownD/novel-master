// T-OP1~T-OP2：oop 规则——共享可变状态 OOP_CANDIDATE 正例 / class 实例模块负例，
// 外加 MANY_EXPORTS ≥6 判据（旧实现口径，注释 ≥8 系旧脚本笔误）与 --strict 阻断差异 + CLI e2e。
// CLI 用例在包内 gitignored 的 tmp-git-test/ 下构造（子目录名带 top- 前缀），用完即删。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { scanOop } from "../dist/rules/oop.js";

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

/** OOP 正例：两个导出函数读写同一份模块级 Map。 */
const OOP_POSITIVE = "const cache = new Map<string, string>();\nexport function putItem(key: string, value: string): void { cache.set(key, value); }\nexport function readItem(key: string): string | undefined { return cache.get(key); }\n";

/** OOP 负例：class 实例模块——状态是实例字段不是模块级，不应建类。 */
const OOP_NEGATIVE = "export class ItemStore {\n  private items = new Map<string, string>();\n  putItem(key: string, value: string): void { this.items.set(key, value); }\n  readItem(key: string): string | undefined { return this.items.get(key); }\n}\n";

test("T-OP1 模块级可变状态被 ≥2 个导出函数共享 → OOP_CANDIDATE；--strict 才 blocking", () => {
  const findings = scanOop({ entries: [{ file: "packages/core/src/cache.ts", text: OOP_POSITIVE }] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, "OOP_CANDIDATE");
  assert.equal(findings[0].rule, "oop");
  assert.ok(findings[0].detail.includes("cache×2"), `detail 应含共享状态统计：${findings[0].detail}`);
  assert.equal(findings[0].blocking, false, "默认记录不阻断");
  const strict = scanOop({ entries: [{ file: "packages/core/src/cache.ts", text: OOP_POSITIVE }], strict: true });
  assert.equal(strict[0].blocking, true, "--strict 才阻断");
  const letState = "let counter = 0;\nexport function bump(): void { counter += 1; }\nexport function read(): number { return counter; }\n";
  const findingsLet = scanOop({ entries: [{ file: "packages/core/src/counter.ts", text: letState }] });
  assert.equal(findingsLet[0].verdict, "OOP_CANDIDATE", "模块级 let 同判");
});

test("T-OP2 class 实例模块与纯函数模块不报；导出 ≥6 才 MANY_EXPORTS（≥6 判据为准）", () => {
  assert.deepEqual(scanOop({ entries: [{ file: "packages/core/src/store.ts", text: OOP_NEGATIVE }] }), [], "class 实例模块负例");
  const five = [1, 2, 3, 4, 5].map((n) => `export function pure${n}(x: number): number { return x + ${n}; }`).join("\n");
  assert.deepEqual(scanOop({ entries: [{ file: "packages/core/src/five.ts", text: five }] }), [], "5 个导出纯函数不报");
  const six = [1, 2, 3, 4, 5, 6].map((n) => `export function pure${n}(x: number): number { return x + ${n}; }`).join("\n");
  const findings = scanOop({ entries: [{ file: "packages/core/src/six.ts", text: six }] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, "MANY_EXPORTS", "第 6 个导出函数触发 MANY_EXPORTS（实现口径 ≥6）");
  assert.ok(findings[0].detail.includes("6 funcs"));
});

test("CLI e2e：check <paths> 默认只记录（oop=INFO(n) 不阻断），--strict 时 OOP_CANDIDATE 阻断 exit 1", () => {
  const repo = makeRepo("top-cli", { "packages/core/src/cache.ts": OOP_POSITIVE });
  try {
    const normal = runCli(["check", "packages/core/src"], repo);
    assert.equal(normal.status, 0, `默认模式 oop 只记录：${normal.stdout}`);
    assert.ok(normal.stdout.includes("OOP_CANDIDATE"), "默认模式输出候选行");
    assert.ok(normal.stdout.includes("oop=INFO(1)"), `汇总应含 oop=INFO(1)：${normal.stdout}`);
    const strict = runCli(["check", "packages/core/src", "--strict"], repo);
    assert.equal(strict.status, 1, "--strict 时候选行阻断");
    assert.ok(strict.stdout.includes("oop=1"), `汇总 oop=1（阻断计数）：${strict.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
