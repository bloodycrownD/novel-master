// 用途：nm-style CLI 入口——子命令分发（check / gate / list / baseline / index）。
// 用法：nm-style <command> [args...]；--help、无参、未知命令打印用法并 exit 2。
// 退出码：0=干净；1=有发现或 gate 新增；2=用法错误；3=构建失败（由 bin 启动器给出）。
// check = signatures + hygiene（阻断矩阵见 rules）+ bare-exports（--changed 阻断 / 其余 INFO）+
//         dup-gate 透传（不阻断，只报数字）+ oop（--strict 阻断）；汇总行五行全实数。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { collectFiles, isTestPath, parseFlags, toPosix } from "./lib/core.js";
import { addedLineFilter } from "./lib/git.js";
import { isSuppressed, loadKfp, matchEntry, type KfpEntry } from "./lib/kfp.js";
import { exitCodeFor, formatFindingsTable, locationOf, toJson, type Finding } from "./lib/report.js";
import { bareDomainFiles, bareFilesMap, bareGateCompare, isInBareDomain, scanBareDomainFiles, scanBareExports, summarizeBuckets, toolVersion } from "./rules/bare-exports.js";
import { renderClusters, viewByFile, viewLongNames, viewModifiers, viewSubjectFamilies } from "./rules/clusters.js";
import { dupBaselinePayload, dupGateCompare, salvageJudged, scanDupGroups, type DupGroups, type JudgedSections } from "./rules/dup.js";
import { scanOop } from "./rules/oop.js";
import { hygieneUnits, scanHygiene, type HygieneMode } from "./rules/hygiene.js";
import { rangeScanInput, scanSignatures, type SignaturesScanContext } from "./rules/signatures.js";
import { buildSymbolIndex } from "./lib/symbols.js";

const USAGE_LINES = [
  "nm-style <command> [args...]",
  "",
  "commands:",
  "  check    [--changed | --all | <paths...>] [--range <spec> | --since <base>] [--strict] [--json] [--include-tests]",
  "  gate     dup | bare [--baseline <path>] [--include-tests]",
  "  list     bare --summary | --bucket <桶> | clusters --all  [--json] [--include-tests]",
  "  baseline write dup | bare  --baseline <path>",
  "  index    [--json]",
  "",
  "exit codes: 0=干净 1=有发现 2=用法错误 3=构建失败",
];

const USAGE = USAGE_LINES.join("\n");

const KNOWN_COMMANDS = new Set(["check", "gate", "list", "baseline", "index"]);

const DUP_BASELINE_NOTE = "签名重复基线 v2。新增重复组会让 gate 打红；存量允许保留（刻意重复：双端镜像对、测试 helper、接口实现）。judged 段=人工裁决的有意保留组，键消失时由下次 write 警告丢弃。";
const BARE_BASELINE_NOTE = "nm-style 裸导出基线。gate bare 判据：新增文件条目或既有文件新增函数名 → exit 1；减少是改善，不阻断。重建：nm-style baseline write bare --baseline <path>。";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function main(): number {
  const args = process.argv.slice(2);
  const commandIndex = args.findIndex((arg) => !arg.startsWith("-"));
  const command = commandIndex >= 0 ? args[commandIndex] : null;
  if (args.length === 0 || args.includes("--help") || command == null) {
    console.log(USAGE);
    return 2;
  }
  if (!KNOWN_COMMANDS.has(command)) {
    console.error(`nm-style: 未知命令「${command}」\n\n${USAGE}`);
    return 2;
  }
  const rest = args.slice(commandIndex + 1);
  if (command === "check") return runCheck(rest);
  if (command === "gate") return runGate(rest);
  if (command === "list") return runList(rest);
  if (command === "baseline") return runBaseline(rest);
  if (command === "index") return runIndex(rest);
  console.error(`nm-style: 命令「${command}」尚未实现`);
  return 2;
}

/** `--range/--since` 取值提取；--since <base> 归一为 <base>...HEAD（旧脚本语义）。缺值返回 error 供用法报错。 */
function rangeSpecOf(argv: string[]): { range: string | null; error: string | null } {
  const index = argv.findIndex((arg) => arg === "--range" || arg === "--since");
  if (index < 0) return { range: null, error: null };
  const flag = argv[index];
  const value = argv[index + 1];
  if (value == null || value.startsWith("--")) return { range: null, error: `${flag} 需要一个值（如 --range main...HEAD、--since <base>）` };
  return { range: flag === "--since" ? `${value}...HEAD` : value, error: null };
}

/** 带值选项提取（--baseline / --bucket）；缺值返回 error 供用法报错。 */
function optionValueOf(argv: string[], flag: string): { value: string | null; error: string | null } {
  const index = argv.indexOf(flag);
  if (index < 0) return { value: null, error: null };
  const value = argv[index + 1];
  if (value == null || value.startsWith("--")) return { value: null, error: `${flag} 需要一个值` };
  return { value, error: null };
}

function insideGitWorktree(): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  return result.status === 0 && result.stdout?.trim() === "true";
}

function runCheck(argv: string[]): number {
  const flags = parseFlags(argv);
  const { range, error } = rangeSpecOf(argv);
  if (error != null) {
    console.error(`nm-style: ${error}`);
    return 2;
  }
  let context: SignaturesScanContext;
  // mode 只影响 hygiene 的 exported 面阻断口径（spec §3.3 阻断矩阵）：--range 与 --changed 同属 diff
  // 审阅通道按严格口径；<paths> 默认目录模式（exported 面只报不阻断）；--all/无参走缺省扫描面（严格）。
  let mode: HygieneMode;
  if (range != null) {
    if (!insideGitWorktree()) {
      console.error("nm-style: --range/--since 需要 git 仓：当前目录不在 git 工作树内（cwd=被扫仓根）。");
      return 2;
    }
    context = rangeScanInput(range, flags.includeTests);
    mode = "changed";
  } else if (flags.changed) {
    if (!insideGitWorktree()) {
      console.error("nm-style: --changed 需要 git 仓：当前目录不在 git 工作树内（cwd=被扫仓根）。");
      return 2;
    }
    context = { entries: collectFiles(flags).map((file) => ({ file, text: null })), isAdded: addedLineFilter(true) };
    mode = "changed";
  } else if (flags.paths.length > 0) {
    context = { entries: collectFiles(flags).map((file) => ({ file, text: null })), isAdded: () => true };
    mode = flags.strict ? "strict" : "paths";
  } else {
    // 缺省扫描面（--all / 无参 → packages/core/src，spec §3.3 保旧默认）；cwd=被扫仓根契约。
    if (!fs.existsSync(path.resolve(process.cwd(), "packages/core/src"))) {
      console.error("nm-style: 缺省扫描面 packages/core/src 不存在（cwd=被扫仓根）；请用 --changed / <paths...> / --range/--since 显式指定扫描面。");
      return 2;
    }
    context = { entries: collectFiles(flags).map((file) => ({ file, text: null })), isAdded: () => true };
    mode = flags.strict ? "strict" : "all";
  }

  // hygiene 复用同一扫描面；引用面恒全仓（packages+apps ∪ 扫描面），行过滤只作用于报出。
  const hygieneFindings = scanHygiene({ entries: context.entries, units: hygieneUnits(context.entries), isAdded: context.isAdded, mode, snapshotDir: path.resolve(process.cwd(), "packages/core/test/package-exports/snapshots") });
  const findings = [...scanSignatures(context), ...hygieneFindings];
  // oop 与 check 同扫描面，恒排除测试路径（旧 check-oop includeTests:false 保形）；--strict 才阻断。
  const oopFindings = scanOop({ entries: context.entries.filter((entry) => !isTestPath(toPosix(entry.file))), strict: flags.strict });
  const kfp = loadKfp();
  const reported: Finding[] = [];
  const downgraded: Array<{ finding: Finding; entry: KfpEntry }> = [];
  let suppressed = 0;
  for (const finding of [...findings, ...oopFindings]) {
    if (isSuppressed(finding.file, kfp)) {
      suppressed += 1;
      continue;
    }
    // KFP 只对阻断行降级（旧 assess 语义：非阻断行连 KFP 查找都不进）——KEEP_*/AMBIGUOUS/非严格导出面直接输出。
    if (!finding.blocking) {
      reported.push(finding);
      continue;
    }
    const entry = matchEntry(finding, kfp);
    if (entry != null) {
      downgraded.push({ finding: { ...finding, blocking: false }, entry });
      continue;
    }
    reported.push(finding);
  }

  // bare-exports 段：全域口径（spec §3.5.3）——--changed 阻断（含 HEAD 同名兜底），其余 INFO 计数；
  // 文件集=当前模式的文件集 ∩ 全域（--all/无参直接全域）；不吃 KFP/suppress。
  const bareEntries = flags.changed
    ? collectFiles(flags).map((file) => ({ file: toPosix(file), text: null as string | null })).filter((entry) => isInBareDomain(entry.file))
    : range != null
      ? context.entries.map((entry) => ({ file: toPosix(entry.file), text: entry.text })).filter((entry) => isInBareDomain(entry.file))
      : flags.paths.length > 0
        ? collectFiles(flags).map((file) => ({ file: toPosix(file), text: null as string | null })).filter((entry) => isInBareDomain(entry.file))
        : bareDomainFiles(flags.includeTests).map((file) => ({ file, text: null as string | null }));
  const bareFindings = scanBareExports({ entries: bareEntries, changed: flags.changed, isAdded: context.isAdded });
  const bareBlocked = bareFindings.filter((finding) => finding.blocking);

  // dup gate 透传：只报数字不阻断（spec §3.3「check = … + dup-gate 透传（不阻断，保持现状）」）。
  const dup = dupPassthrough();

  if (flags.json) {
    console.log(toJson([...reported, ...downgraded.map((item) => item.finding), ...bareBlocked]));
    return exitCodeFor(reported) === 1 || bareBlocked.length > 0 ? 1 : 0;
  }
  console.log(`== nm-style check ==（signatures + hygiene + bare-exports + dup + oop，扫描 ${context.entries.length} 个文件）`);
  if (reported.length > 0) console.log(formatFindingsTable(reported));
  for (const { finding, entry } of downgraded) console.log(`INFO  ${locationOf(finding)}  ${finding.symbol}  [${entry.category ?? "known-false-positive"}] ${entry.reason}`);
  if (suppressed > 0) console.log(`↓↓ nm-style：${suppressed} 处命中 suppressPrefixes（${kfp.suppressPrefixes.join(", ")}），已跳过`);
  console.log("\n== bare-exports ==");
  if (flags.changed) {
    if (bareBlocked.length > 0) console.log(formatFindingsTable(bareBlocked));
    console.log(bareBlocked.length === 0 ? "bare-exports: PASS（改动文件无新增裸顶层 export function）" : `bare-exports: FIND(${bareBlocked.length})`);
  } else {
    console.log(`bare-exports: INFO(${bareFindings.length}) 存量裸顶层 export function（p24 收编对象，此处只计数不阻断；全仓清单见 nm-style list bare --summary）`);
  }
  console.log("\n== dup（gate 透传，不阻断；dup=同名+形态 组数，(+新增/-消除)）==");
  for (const line of dup.lines) console.log(line);
  const countOf = (rule: string): number => reported.filter((finding) => finding.rule === rule && finding.blocking).length;
  const bareSegment = flags.changed ? String(bareBlocked.length) : `INFO(${bareFindings.length})`;
  const oopSegment = flags.strict ? String(countOf("oop")) : `INFO(${oopFindings.length})`;
  const failed = reported.some((finding) => finding.blocking) || bareBlocked.length > 0;
  console.log(`\nnm-style: ${failed ? "FINDINGS" : "PASS"}（signatures=${countOf("signatures")} hygiene=${countOf("hygiene")} bare-exports=${bareSegment} dup=${dup.summary} oop=${oopSegment}）`);
  return failed ? 1 : 0;
}

/** dup 缺省基线路径（cwd=被扫仓根）：scripts/dup-signatures-baseline.json。 */
function dupBaselineDefault(): string {
  return path.join("scripts", "dup-signatures-baseline.json");
}

/** bare 缺省基线路径（cwd=被扫仓根）：scripts/bare-exports-baseline.json。 */
function bareBaselineDefault(): string {
  return path.join("scripts", "bare-exports-baseline.json");
}

/** check 内的 dup 透传：跑一次 gate 比对取数字，不参与 exit code；基线缺失/损坏时降级说明。 */
function dupPassthrough(): { summary: string; lines: string[] } {
  const baselinePath = path.resolve(process.cwd(), dupBaselineDefault());
  if (!fs.existsSync(baselinePath)) return { summary: "无基线", lines: [] };
  let base: { named?: Record<string, unknown>; shaped?: Record<string, unknown> };
  try {
    base = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  } catch (error) {
    console.error(`nm-style: dup 基线解析失败，透传跳过 —— ${errorMessage(error)}`);
    return { summary: "基线损坏", lines: [] };
  }
  const current = scanDupGroups();
  const cmp = dupGateCompare(base, current);
  const added = cmp.addedNamed.length + cmp.addedShaped.length;
  const baseNamed = Object.keys(base.named ?? {}).length;
  const baseShaped = Object.keys(base.shaped ?? {}).length;
  return {
    summary: `${baseNamed}+${baseShaped}→${Object.keys(current.named).length}+${Object.keys(current.shaped).length}(+${added}/-${cmp.goneNamed.length + cmp.goneShaped.length})`,
    lines: [
      `dup-signatures: 同名 ${baseNamed}→${Object.keys(current.named).length}（新增 ${cmp.addedNamed.length} / 消除 ${cmp.goneNamed.length}）`,
      `dup-signatures: 形态 ${baseShaped}→${Object.keys(current.shaped).length}（新增 ${cmp.addedShaped.length} / 消除 ${cmp.goneShaped.length}）`,
      `dup-signatures: ${added === 0 ? "PASS（无新增重复）" : `FIND（新增 ${added} 组，需人工判定：合并 or 说明保留理由）`}`,
    ],
  };
}

function runGate(argv: string[]): number {
  const target = argv.find((arg) => !arg.startsWith("-"));
  if (target !== "dup" && target !== "bare") {
    console.error(`nm-style: gate 需要目标 dup | bare\n\n${USAGE}`);
    return 2;
  }
  const { value: baseline, error } = optionValueOf(argv, "--baseline");
  if (error != null) {
    console.error(`nm-style: ${error}`);
    return 2;
  }
  const baselinePath = path.resolve(process.cwd(), baseline ?? (target === "dup" ? dupBaselineDefault() : bareBaselineDefault()));
  if (!fs.existsSync(baselinePath)) {
    console.error(`nm-style: 基线不存在：${baselinePath}。先跑 baseline write ${target} --baseline <path>。`);
    return 2;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  } catch (error) {
    console.error(`nm-style: 基线解析失败：${baselinePath} —— ${errorMessage(error)}`);
    return 2;
  }
  return target === "dup" ? gateDup(parsed, baselinePath) : gateBare(parsed, argv.includes("--include-tests"));
}

function gateDup(baseline: unknown, baselinePath: string): number {
  const base = (baseline ?? {}) as { named?: Record<string, unknown>; shaped?: Record<string, unknown> };
  const current = scanDupGroups();
  const cmp = dupGateCompare(base, current);
  const baseNamed = Object.keys(base.named ?? {}).length;
  const baseShaped = Object.keys(base.shaped ?? {}).length;
  console.log(`dup-signatures: 同名 ${baseNamed}→${Object.keys(current.named).length}（新增 ${cmp.addedNamed.length} / 消除 ${cmp.goneNamed.length}）`);
  console.log(`dup-signatures: 形态 ${baseShaped}→${Object.keys(current.shaped).length}（新增 ${cmp.addedShaped.length} / 消除 ${cmp.goneShaped.length}）`);
  if (cmp.addedNamed.length) {
    console.log("\n[新增同名重复]——要么合并，要么在报告说明为什么必须各留一份：");
    for (const key of cmp.addedNamed) {
      console.log(`  ${key}`);
      for (const site of current.named[key]) console.log(`     ${site}`);
    }
  }
  if (cmp.addedShaped.length) {
    console.log("\n[新增同形态重复]（名字不同但参数一模一样，最可能是改名复制）：");
    for (const key of cmp.addedShaped.slice(0, 20)) {
      console.log(`  ${key}`);
      for (const site of current.shaped[key]) console.log(`     ${site}`);
    }
  }
  if (cmp.goneNamed.length) console.log(`\n[已消除同名重复] ${cmp.goneNamed.length} 组：${cmp.goneNamed.join(", ")}`);
  if (cmp.goneShaped.length) console.log(`[已消除同形态重复] ${cmp.goneShaped.length} 组`);
  const bad = cmp.addedNamed.length + cmp.addedShaped.length;
  console.log(`\ndup-signatures: ${bad === 0 ? "PASS（无新增重复）" : `FIND（新增 ${bad} 组，需人工判定：合并 or 说明保留理由）`}（基线 ${baselinePath}）`);
  return bad === 0 ? 0 : 1;
}

function gateBare(baseline: unknown, includeTests: boolean): number {
  const base = (baseline ?? {}) as { includeTests?: unknown; files?: Record<string, string[]> };
  if (typeof base.includeTests === "boolean" && base.includeTests !== includeTests) {
    console.error(`nm-style: bare-exports 注意——基线 includeTests=${base.includeTests}，本次 includeTests=${includeTests}，口径不一致`);
  }
  const current = bareFilesMap(includeTests);
  const cmp = bareGateCompare(base.files, current);
  const addedNamesTotal = cmp.addedNames.reduce((n, item) => n + item.names.length, 0);
  console.log(`bare-exports: 基线 ${cmp.baseFileCount} 文件 → 当前 ${cmp.curFileCount} 文件（新增文件 ${cmp.addedFiles.length} / 新增函数 ${addedNamesTotal} / 改善 ${cmp.removedCount}）`);
  if (cmp.addedFiles.length) {
    console.log("\n[新增裸导出文件]");
    for (const item of cmp.addedFiles) console.log(`  ${item.file}: ${item.names.join(", ")}`);
  }
  if (cmp.addedNames.length) {
    console.log("\n[既有文件新增裸导出]");
    for (const item of cmp.addedNames) console.log(`  ${item.file}: +${item.names.join(", +")}`);
  }
  const bad = cmp.addedFiles.length + addedNamesTotal;
  console.log(`\nbare-exports: ${bad === 0 ? "PASS（无新增裸导出）" : `FIND（新增 ${bad} 处，p24 期间新顶层 export function 必须直接进 namespace；确需裸导出加 nm-style: keep-bare 注释）`}`);
  return bad === 0 ? 0 : 1;
}

function runList(argv: string[]): number {
  const target = argv.find((arg) => !arg.startsWith("-"));
  if (target !== "bare" && target !== "clusters") {
    console.error(`nm-style: list 需要目标 bare | clusters\n\n${USAGE}`);
    return 2;
  }
  const includeTests = argv.includes("--include-tests");
  if (target === "bare") {
    const { value: bucket, error } = optionValueOf(argv, "--bucket");
    if (error != null) {
      console.error(`nm-style: ${error}`);
      return 2;
    }
    if (!argv.includes("--summary") && bucket == null && !argv.includes("--json")) {
      console.error(`nm-style: list bare 需要 --summary | --bucket <桶> | --json 之一\n\n${USAGE}`);
      return 2;
    }
    const entries = scanBareDomainFiles(includeTests);
    if (argv.includes("--json")) return printBareJson(entries, includeTests);
    if (bucket != null) {
      console.log(renderBucket(entries, bucket));
      return 0;
    }
    console.log(renderSummary(entries));
    return 0;
  }
  if (!argv.includes("--all")) {
    console.error(`nm-style: list clusters 需要 --all（四视图全量）\n\n${USAGE}`);
    return 2;
  }
  const entries = scanBareDomainFiles(includeTests);
  if (argv.includes("--json")) {
    const payload = {
      repo: process.cwd(),
      includeTests,
      totals: { files: entries.length, functions: entries.reduce((n, f) => n + f.functions.length, 0) },
      subjects: viewSubjectFamilies(entries),
      modifiers: viewModifiers(entries).map(([modifier, sites]) => ({ modifier, sites })),
      longNames: viewLongNames(entries),
      byFile: viewByFile(entries),
    };
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }
  console.log(renderClusters(entries));
  return 0;
}

/** list bare --summary 文本（与 worktree list-bare-exports.mjs printSummary 同版式）。 */
function renderSummary(entries: ReturnType<typeof scanBareDomainFiles>): string {
  const buckets = [...summarizeBuckets(entries).entries()].sort((a, b) => b[1].functions - a[1].functions || a[0].localeCompare(b[0]));
  const totalFn = entries.reduce((n, f) => n + f.functions.length, 0);
  const lines = [`裸顶层 export function：${entries.length} 个文件 / ${totalFn} 个函数（按函数数降序）`, "", `${"域桶".padEnd(40)} ${"文件".padStart(6)} ${"函数".padStart(6)}`];
  for (const [name, b] of buckets) lines.push(`${name.padEnd(40)} ${String(b.files).padStart(6)} ${String(b.functions).padStart(6)}`);
  lines.push(`${"TOTAL".padEnd(40)} ${String(entries.length).padStart(6)} ${String(totalFn).padStart(6)}`);
  return lines.join("\n");
}

/** list bare --bucket <桶> 文本（与 worktree printBucket 同版式）。 */
function renderBucket(entries: ReturnType<typeof scanBareDomainFiles>, bucket: string): string {
  const hit = entries.filter((f) => f.bucket === bucket).sort((a, b) => b.functions.length - a.functions.length || a.file.localeCompare(b.file));
  const totalFn = hit.reduce((n, f) => n + f.functions.length, 0);
  const lines = [`桶 ${bucket}：${hit.length} 个文件 / ${totalFn} 个函数（按函数数降序）`];
  if (hit.length === 0) return [...lines, "（该桶没有裸导出，或桶名写错——可用 --summary 查看全部桶名）"].join("\n");
  for (const f of hit) lines.push(`${f.file.padEnd(78)} ${String(f.functions.length).padStart(3)}  ${f.functions.map((fn) => fn.name).join(", ")}`);
  return lines.join("\n");
}

/** list bare --json（与 worktree --json 同结构）。 */
function printBareJson(entries: ReturnType<typeof scanBareDomainFiles>, includeTests: boolean): number {
  const buckets = Object.fromEntries([...summarizeBuckets(entries).entries()].sort((a, b) => b[1].functions - a[1].functions).map(([k, v]) => [k, v]));
  const payload = {
    repo: process.cwd(),
    includeTests,
    totals: { files: entries.length, functions: entries.reduce((n, f) => n + f.functions.length, 0) },
    buckets,
    files: entries.map((f) => ({ file: f.file, bucket: f.bucket, count: f.functions.length, functions: f.functions.map((fn) => fn.name) })),
  };
  console.log(JSON.stringify(payload, null, 2));
  return 0;
}

function runBaseline(argv: string[]): number {
  if (argv[0] !== "write") {
    console.error(`nm-style: baseline 只支持 write（baseline write dup | bare --baseline <path>）\n\n${USAGE}`);
    return 2;
  }
  const target = argv[1];
  if (target !== "dup" && target !== "bare") {
    console.error(`nm-style: baseline write 需要目标 dup | bare\n\n${USAGE}`);
    return 2;
  }
  const { value: baseline, error } = optionValueOf(argv, "--baseline");
  if (error != null) {
    console.error(`nm-style: ${error}`);
    return 2;
  }
  if (baseline == null) {
    console.error("nm-style: baseline write 必须显式 --baseline <path>（防误写，不提供缺省路径）");
    return 2;
  }
  return target === "dup" ? writeDupBaseline(path.resolve(process.cwd(), baseline)) : writeBareBaseline(path.resolve(process.cwd(), baseline), argv.includes("--include-tests"));
}

function writeDupBaseline(baselinePath: string): number {
  const current: DupGroups = scanDupGroups();
  let judged: JudgedSections = { named: {}, shaped: {} };
  let salvaged = 0;
  if (fs.existsSync(baselinePath)) {
    try {
      // 抢救旧文件里的人工裁决（judgedAfterP17 / judgedAfterP18 / 旧 v2 judged 三层都认）。
      const rescued = salvageJudged(JSON.parse(fs.readFileSync(baselinePath, "utf8")), current);
      judged = rescued.judged;
      salvaged = Object.keys(judged.named).length + Object.keys(judged.shaped).length;
      for (const { section, key } of rescued.dropped) console.error(`nm-style: judged 裁决键「${key}」（${section}）已不在当前扫描，salvage 丢弃`);
    } catch (error) {
      console.error(`nm-style: 旧基线解析失败，judged salvage 跳过 —— ${errorMessage(error)}`);
    }
  }
  const payload = dupBaselinePayload(current, judged, DUP_BASELINE_NOTE);
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`已写基线：${payload.namedGroups} 组同名 / ${payload.shapedGroups} 组同形态（judged 并入 ${salvaged} 条）→ ${baselinePath}`);
  return 0;
}

function writeBareBaseline(baselinePath: string, includeTests: boolean): number {
  const files = bareFilesMap(includeTests);
  const payload = { note: BARE_BASELINE_NOTE, toolVersion: toolVersion(), generatedAt: new Date().toISOString(), includeTests, files };
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const totalFn = Object.values(files).reduce((n, v) => n + v.length, 0);
  console.log(`已写基线：${Object.keys(files).length} 文件 / ${totalFn} 函数 → ${baselinePath}`);
  return 0;
}

/** `index [--json]`：调试——dump 当前仓（packages+apps 口径树，与 hygiene 引用面同宇宙）的 symbol-index。 */
function runIndex(argv: string[]): number {
  const flags = parseFlags(argv);
  const units = hygieneUnits([]);
  const index = buildSymbolIndex(units);
  if (flags.json) {
    console.log(JSON.stringify({ files: units.length, symbols: index.symbols, bindings: index.bindings }, null, 2));
    return 0;
  }
  const byForm = new Map<string, number>();
  for (const symbol of index.symbols) byForm.set(symbol.form, (byForm.get(symbol.form) ?? 0) + 1);
  console.log(`== nm-style index ==（${units.length} 个文件，${index.symbols.length} 个符号，${index.bindings.length} 条绑定）`);
  for (const [form, count] of [...byForm].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${form.padEnd(16)} ${count}`);
  return 0;
}

process.exit(main());
