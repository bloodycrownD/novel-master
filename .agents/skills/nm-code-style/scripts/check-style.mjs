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
 *
 * 已知假阳性：同目录 `known-false-positives.json`。匹配的发现由本汇总层降级为
 * INFO（不计入阻断），`suppressPrefixes` 下的路径不出现在报告里。清单只影响汇总层
 * 的阻断判定——三个子检查器的判据原样保留，删掉清单即回到原始报告。
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectFiles, parseFlags, toPosix } from "./lib/style-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const flags = parseFlags(process.argv.slice(2));
const extra = [...(flags.includeTests ? ["--include-tests"] : []), ...(flags.changed ? ["--changed"] : [])];
const SEGMENTS = new Set(["signatures", "inline", "methods"]);
const BLOCKING_METHOD_VERDICTS = new Set(["DEAD_METHOD", "INLINE_METHOD", "PASS_THROUGH_METHOD", "DEPRECATED_DEAD", "DEPRECATED_METHOD"]);
const manifest = loadKnownFalsePositives(path.join(scriptDir, "known-false-positives.json"));

function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(scriptDir, script), ...args], { stdio: "inherit" });
  return result.status ?? 1;
}

/** 以 JSON 模式再跑一次，供汇总层做降级；解析不了返回 null（调用方回退到子检查器退出码）。 */
function runJson(script, args) {
  const result = spawnSync(process.execPath, [path.join(scriptDir, script), ...args, "--json"], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (typeof result.stdout !== "string" || result.stdout.trim() === "") return null;
  try {
    const rows = JSON.parse(result.stdout);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

function loadKnownFalsePositives(file) {
  const empty = { entries: [], suppressPrefixes: [] };
  if (!fs.existsSync(file)) return empty;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`check-style: ${path.basename(file)} 解析失败，按无豁免运行 —— ${error.message}`);
    return empty;
  }
  const entries = (Array.isArray(parsed.entries) ? parsed.entries : []).filter((entry) => entry != null && SEGMENTS.has(entry.segment) && typeof entry.file === "string" && entry.file.length > 0 && typeof entry.reason === "string");
  const suppressPrefixes = (Array.isArray(parsed.suppressPrefixes) ? parsed.suppressPrefixes : []).filter((value) => typeof value === "string" && value.length > 0).map((value) => {
    const posix = toPosix(value);
    return posix.endsWith("/") ? posix : `${posix}/`;
  });
  const total = Array.isArray(parsed.entries) ? parsed.entries.length : 0;
  if (entries.length < total) console.error(`check-style: ${path.basename(file)} 有 ${total - entries.length} 条条目缺 segment/file/reason，已忽略`);
  return { entries, suppressPrefixes };
}

function isSuppressed(relPath) {
  return manifest.suppressPrefixes.some((prefix) => relPath.startsWith(prefix) || relPath === prefix.slice(0, -1));
}

/** `path/to/file.ts:123` → { file, line }；签名/内联/方法三种报告格式共用。 */
function splitLocation(location) {
  const text = String(location ?? "");
  const match = /^(.+):(\d+)$/.exec(text);
  return match == null ? { file: text, line: null } : { file: match[1], line: Number(match[2]) };
}

/** 行名：inline 的 name、methods 的 Class.method、signatures 的 detail。 */
function rowSymbol(row) {
  return row.name ?? row.detail ?? "";
}

function knownFalsePositive(segment, row) {
  const { file, line } = splitLocation(row.location);
  return manifest.entries.find((entry) => {
    if (entry.segment !== segment) return false;
    if (toPosix(entry.file) !== file) return false;
    if (entry.line != null && entry.line !== line) return false;
    if (entry.symbol == null) return true;
    const symbol = rowSymbol(row);
    return symbol === entry.symbol || symbol.endsWith(`.${entry.symbol}`);
  }) ?? null;
}

function isBlocking(segment, row) {
  if (segment === "signatures") return true;
  if (segment === "inline") return row.verdict !== "KEEP_LOCAL";
  return BLOCKING_METHOD_VERDICTS.has(row.verdict);
}

function assess(segment, rows) {
  if (rows == null) return null;
  const blocked = [];
  const downgraded = [];
  let suppressed = 0;
  for (const row of rows) {
    const { file } = splitLocation(row.location);
    if (isSuppressed(file)) {
      suppressed += 1;
      continue;
    }
    if (!isBlocking(segment, row)) continue;
    const entry = knownFalsePositive(segment, row);
    if (entry != null) {
      downgraded.push({ row, entry });
      continue;
    }
    blocked.push(row);
  }
  return { blocked, downgraded, suppressed };
}

/**
 * 子检查器照原样输出（规则行与原始报告不变），再用 JSON 结果算阻断：
 * 命中清单的降级成 INFO，suppressPrefixes 下的行跳过。返回是否通过。
 */
function report(segment, script, args) {
  const status = run(script, args);
  const assessed = assess(segment, runJson(script, args));
  if (assessed == null) {
    console.error(`check-style: ${script} 的 JSON 汇总失败，按子检查器退出码判定`);
    return status === 0;
  }
  if (assessed.downgraded.length > 0) {
    console.log(`↓↓ ${script}：${assessed.downgraded.length} 处 known-false-positive 降级为 INFO（不阻断；依据见 known-false-positives.json）`);
    for (const { row, entry } of assessed.downgraded) console.log(`INFO  ${row.location}  ${rowSymbol(row)}  [${entry.category ?? "known-false-positive"}] ${entry.reason}`);
  }
  if (assessed.suppressed > 0) console.log(`↓↓ ${script}：${assessed.suppressed} 处命中 suppressPrefixes（${manifest.suppressPrefixes.join(", ")}），已跳过`);
  return assessed.blocked.length === 0;
}

console.log("== check-signatures ==");
const signatures = report("signatures", "check-signatures.mjs", [...extra, ...flags.paths]);
console.log("\n== check-inline ==");
const inline = report("inline", "check-inline.mjs", [...extra, ...flags.paths]);
console.log("\n== check-methods ==");
const methods = report("methods", "check-methods.mjs", [...extra, ...flags.paths]);

const fakeTargets = (flags.all ? ["packages/core/src"] : flags.changed ? collectFiles({ ...flags, changed: true, includeTests: false }) : flags.paths.length > 0 ? flags.paths : ["packages/core/src"]).filter((target) => !isSuppressed(toPosix(path.resolve(target))));
const fakeStrict = flags.changed || flags.all || flags.strict;
let fakeFailed = false;
if (fakeTargets.length === 0) console.log("\n== find-fake-exports: 目标全部落在 suppressPrefixes 内，跳过 ==");
for (const target of fakeTargets) {
  console.log(`\n== find-fake-exports: ${toPosix(path.resolve(target))} ==`);
  const args = [target];
  if (fakeStrict) args.push("--strict");
  if (run("find-fake-exports.mjs", args) !== 0) fakeFailed = true;
}

const failed = !signatures || !inline || !methods || fakeFailed;
console.log("\n== check-oop ==");
const oop = run("check-oop.mjs", [...(flags.changed ? ["--changed"] : []), ...flags.paths, ...(flags.strict ? ["--strict"] : [])]);
const oopFailed = flags.strict && oop !== 0;
console.log(`\ncheck-style: ${failed || oopFailed ? "FINDINGS" : "PASS"}（signatures=${signatures ? "PASS" : "FIND"} inline=${inline ? "PASS" : "FIND"} methods=${methods ? "PASS" : "FIND"} exports=${fakeFailed ? "FIND" : "PASS"} oop=${oop === 0 ? "PASS" : "REVIEW"}）`);
process.exit(failed || oopFailed ? 1 : 0);
