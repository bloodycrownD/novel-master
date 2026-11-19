// 用途：nm-style CLI 入口——子命令分发（check / gate / list / baseline / index）。
// 用法：nm-style <command> [args...]；--help、无参、未知命令打印用法并 exit 2。
// 退出码：0=干净；1=有发现或 gate 新增；2=用法错误；3=构建失败（由 bin 启动器给出）。
// 现状：check 接 signatures + hygiene（spec Step 5）；bare-exports / dup / oop 由后续波次接入。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { collectFiles, parseFlags } from "./lib/core.js";
import { addedLineFilter } from "./lib/git.js";
import { isSuppressed, loadKfp, matchEntry, type KfpEntry } from "./lib/kfp.js";
import { exitCodeFor, formatFindingsTable, locationOf, toJson, type Finding } from "./lib/report.js";
import { hygieneUnits, scanHygiene, type HygieneMode } from "./rules/hygiene.js";
import { rangeScanInput, scanSignatures, type SignaturesScanContext } from "./rules/signatures.js";

const USAGE_LINES = [
  "nm-style <command> [args...]",
  "",
  "commands:",
  "  check    [--changed | --all | <paths...>] [--range <spec> | --since <base>] [--strict] [--json] [--include-tests]",
  "  gate     dup | bare",
  "  list     bare --summary | --bucket <桶> | clusters --all  [--json]",
  "  baseline write dup | bare  --baseline <path>",
  "  index    [--json]",
  "",
  "exit codes: 0=干净 1=有发现 2=用法错误 3=构建失败",
];

const USAGE = USAGE_LINES.join("\n");

const KNOWN_COMMANDS = new Set(["check", "gate", "list", "baseline", "index"]);

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
  if (command === "check") return runCheck(args.slice(commandIndex + 1));
  console.error(`nm-style: 命令「${command}」尚未实现（后续波次接入）`);
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
  const kfp = loadKfp();
  const reported: Finding[] = [];
  const downgraded: Array<{ finding: Finding; entry: KfpEntry }> = [];
  let suppressed = 0;
  for (const finding of findings) {
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

  if (flags.json) {
    console.log(toJson([...reported, ...downgraded.map((item) => item.finding)]));
    return exitCodeFor(reported);
  }
  console.log(`== nm-style check ==（signatures + hygiene，扫描 ${context.entries.length} 个文件）`);
  if (reported.length > 0) console.log(formatFindingsTable(reported));
  for (const { finding, entry } of downgraded) console.log(`INFO  ${locationOf(finding)}  ${finding.symbol}  [${entry.category ?? "known-false-positive"}] ${entry.reason}`);
  if (suppressed > 0) console.log(`↓↓ nm-style：${suppressed} 处命中 suppressPrefixes（${kfp.suppressPrefixes.join(", ")}），已跳过`);
  // TODO(wave-4): bare-exports / dup / oop 接入后替换下方三个占位 0。
  const countOf = (rule: string): number => reported.filter((finding) => finding.rule === rule && finding.blocking).length;
  console.log(`\nnm-style: ${reported.some((finding) => finding.blocking) ? "FINDINGS" : "PASS"}（signatures=${countOf("signatures")} hygiene=${countOf("hygiene")} bare-exports=0 dup=0 oop=0）`);
  return exitCodeFor(reported);
}

process.exit(main());
