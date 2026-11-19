// 用途：nm-style CLI 入口——子命令分发（check / gate / list / baseline / index）。
// 用法：nm-style <command> [args...]；--help、无参、未知命令打印用法并 exit 2。
// 退出码：0=干净；1=有发现或 gate 新增；2=用法错误；3=构建失败（由 bin 启动器给出）。
// 现状：check 只接 signatures 段（spec Step 4）；hygiene / bare-exports / dup / oop 由后续波次接入。

import { spawnSync } from "node:child_process";
import { collectFiles, parseFlags } from "./lib/core.js";
import { addedLineFilter } from "./lib/git.js";
import { isSuppressed, loadKfp, matchEntry, type KfpEntry } from "./lib/kfp.js";
import { exitCodeFor, formatFindingsTable, locationOf, toJson, type Finding } from "./lib/report.js";
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
  if (range != null) {
    if (!insideGitWorktree()) {
      console.error("nm-style: --range/--since 需要 git 仓：当前目录不在 git 工作树内（cwd=被扫仓根）。");
      return 2;
    }
    context = rangeScanInput(range, flags.includeTests);
  } else if (flags.changed) {
    if (!insideGitWorktree()) {
      console.error("nm-style: --changed 需要 git 仓：当前目录不在 git 工作树内（cwd=被扫仓根）。");
      return 2;
    }
    context = { entries: collectFiles(flags).map((file) => ({ file, text: null })), isAdded: addedLineFilter(true) };
  } else if (flags.paths.length > 0) {
    context = { entries: collectFiles(flags).map((file) => ({ file, text: null })), isAdded: () => true };
  } else {
    // TODO(wave-3): 缺省扫描面（--all / 无参 → packages/core/src）随 hygiene 波统一接入。
    console.error("nm-style: 缺省扫描面（--all / 无参 → packages/core/src）尚未接线；本次请用 --changed、<paths...> 或 --range/--since 指定扫描面。");
    return 2;
  }

  const findings = scanSignatures(context);
  const kfp = loadKfp();
  const blocking: Finding[] = [];
  const downgraded: Array<{ finding: Finding; entry: KfpEntry }> = [];
  let suppressed = 0;
  for (const finding of findings) {
    if (isSuppressed(finding.file, kfp)) {
      suppressed += 1;
      continue;
    }
    const entry = matchEntry(finding, kfp);
    if (entry != null) {
      downgraded.push({ finding: { ...finding, blocking: false }, entry });
      continue;
    }
    blocking.push(finding);
  }

  if (flags.json) {
    console.log(toJson([...blocking, ...downgraded.map((item) => item.finding)]));
    return exitCodeFor(blocking);
  }
  console.log(`== nm-style signatures ==（扫描 ${context.entries.length} 个文件）`);
  if (blocking.length > 0) console.log(formatFindingsTable(blocking));
  for (const { finding, entry } of downgraded) console.log(`INFO  ${locationOf(finding)}  ${finding.symbol}  [${entry.category ?? "known-false-positive"}] ${entry.reason}`);
  if (suppressed > 0) console.log(`↓↓ nm-style：${suppressed} 处命中 suppressPrefixes（${kfp.suppressPrefixes.join(", ")}），已跳过`);
  // TODO(wave-3): hygiene / bare-exports / dup / oop 接线后替换下方四个占位 0。
  console.log(`\nnm-style: ${blocking.length > 0 ? "FINDINGS" : "PASS"}（signatures=${blocking.length} hygiene=0 bare-exports=0 dup=0 oop=0）`);
  return exitCodeFor(blocking);
}

process.exit(main());
