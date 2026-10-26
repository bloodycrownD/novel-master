#!/usr/bin/env node
/**
 * nm-code-style 一键检查（只读）：
 *   1. check-signatures.mjs — §2 多行函数参数 / 调用参数 / new 构造 / 短 import / const 或赋值 RHS 拆行
 *   2. check-inline.mjs     — §1/§4 单点私有函数 / 死私有函数 / 转手 wrapper
 *   3. check-methods.mjs    — §1/§9 类方法死代码 / 单点内联 / 薄包装 / 废弃
 *   4. find-fake-exports.mjs — §4.1 假公开 / 仅测试引用 / 死导出
 *   5. check-oop.mjs        — §9 OOP 化候选（默认只提示，--strict 才阻断）
 *
 * 用法：
 *   node .agents/skills/nm-code-style/scripts/check-style.mjs --changed
 *   node .../check-style.mjs --changed --strict
 *   node .../check-style.mjs --all
 *   node .../check-style.mjs packages/core/src/domain/chat/logic
 *   node .../check-style.mjs --changed --include-tests
 *
 * 退出码：signatures / inline / 导出审计有发现 → 1。`--changed` / `--all` / `--strict`
 * 时导出审计按严格模式（INLINE_CANDIDATE 含 public 单点）；默认全 core 扫描仍输出线索表。
 * `--changed` 只覆盖改动文件；找未改动文件里的死导出要用 `--all` 或传目录。
 * 修完必须重跑；内联和删除会制造新的单点/死引用。
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectFiles, parseFlags, toPosix } from "./lib/style-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const flags = parseFlags(process.argv.slice(2));
const extra = [...(flags.includeTests ? ["--include-tests"] : []), ...(flags.changed ? ["--changed"] : [])];

function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(scriptDir, script), ...args], { stdio: "inherit" });
  return result.status ?? 1;
}

console.log("== check-signatures ==");
const signatures = run("check-signatures.mjs", [...extra, ...flags.paths]);
console.log("\n== check-inline ==");
const inline = run("check-inline.mjs", [...extra, ...flags.paths]);
console.log("\n== check-methods ==");
const methods = run("check-methods.mjs", [...extra, ...flags.paths]);

const fakeTargets = flags.all ? ["packages/core/src"] : flags.changed ? collectFiles({ ...flags, changed: true, includeTests: false }) : flags.paths.length > 0 ? flags.paths : ["packages/core/src"];
const fakeStrict = flags.changed || flags.all || flags.strict;
let fakeFailed = false;
for (const target of fakeTargets) {
  console.log(`\n== find-fake-exports: ${toPosix(path.resolve(target))} ==`);
  const args = [target];
  if (fakeStrict) args.push("--strict");
  if (run("find-fake-exports.mjs", args) !== 0) fakeFailed = true;
}

const failed = signatures !== 0 || inline !== 0 || methods !== 0 || fakeFailed;
console.log("\n== check-oop ==");
const oop = run("check-oop.mjs", [...(flags.changed ? ["--changed"] : []), ...flags.paths, ...(flags.strict ? ["--strict"] : [])]);
const oopFailed = flags.strict && oop !== 0;
console.log(`\ncheck-style: ${failed || oopFailed ? "FINDINGS" : "PASS"}（signatures=${signatures === 0 ? "PASS" : "FIND"} inline=${inline === 0 ? "PASS" : "FIND"} methods=${methods === 0 ? "PASS" : "FIND"} exports=${fakeFailed ? "FIND" : "PASS"} oop=${oop === 0 ? "PASS" : "REVIEW"}）`);
process.exit(failed || oopFailed ? 1 : 0);
