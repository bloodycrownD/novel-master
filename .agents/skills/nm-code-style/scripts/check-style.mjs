#!/usr/bin/env node
/**
 * nm-code-style 一键检查（只读）：
 *   1. check-signatures.mjs — §2 多行函数参数 / 调用参数 / new 构造 / 短 import
 *   2. check-inline.mjs     — §1/§4 单点私有函数 / 死私有函数 / 转手 wrapper / 类 private 方法
 *   3. find-fake-exports.mjs — §4.1 假公开 / 仅测试引用 / 死导出
 *
 * 用法：
 *   node .agents/skills/nm-code-style/scripts/check-style.mjs --changed
 *   node .../check-style.mjs packages/core/src/domain/chat/logic
 *   node .../check-style.mjs --changed --include-tests
 *
 * 退出码：signatures 或 inline 有发现 → 1；fake-exports 是线索表，不判定失败。
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

const fakeTargets = flags.changed ? collectFiles({ ...flags, changed: true, includeTests: false }) : flags.paths.length > 0 ? flags.paths : ["packages/core/src"];
for (const target of fakeTargets) {
  console.log(`\n== find-fake-exports: ${toPosix(path.resolve(target))} ==`);
  run("find-fake-exports.mjs", [target]);
}

const failed = signatures !== 0 || inline !== 0;
console.log(`\ncheck-style: ${failed ? "FINDINGS" : "PASS"}（signatures=${signatures === 0 ? "PASS" : "FIND"} inline=${inline === 0 ? "PASS" : "FIND"}）`);
process.exit(failed ? 1 : 0);
