/**
 * nm-style 共用工具：文件遍历、目标收集、源码解析与表格输出。只读，不改文件。
 * cwd 契约：cwd = 被扫仓根（SKILL 与各 spec 依赖）；相对路径归一按调用时 cwd 计算。
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { changedFiles } from "./git.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".worktree", "coverage", "build", ".reference", ".rnstorybook", "tmp", ".zcode", "docs"]);

export interface CliFlags {
  changed: boolean;
  includeTests: boolean;
  all: boolean;
  strict: boolean;
  verbose: boolean;
  json: boolean;
  paths: string[];
}

/** 只提取已知 flag；未知 flag 与 --help 不进任何桶，由 cli 层按用法错误处理。 */
export function parseFlags(argv: string[]): CliFlags {
  return { changed: argv.includes("--changed"), includeTests: argv.includes("--include-tests"), all: argv.includes("--all"), strict: argv.includes("--strict"), verbose: argv.includes("--verbose"), json: argv.includes("--json"), paths: argv.filter((arg) => !arg.startsWith("--")) };
}

export function walk(entry: string, out: string[] = []): string[] {
  const stat = fs.statSync(entry);
  if (stat.isFile()) {
    if (SOURCE_EXTENSIONS.has(path.extname(entry))) out.push(entry);
    return out;
  }
  for (const name of fs.readdirSync(entry)) {
    if (!SKIP_DIRS.has(name)) walk(path.join(entry, name), out);
  }
  return out;
}

/** 绝对路径 → 相对被扫仓根的 posix 路径。按调用时 cwd 计算：CLI 生命周期内 cwd 不变，与旧版模块加载期锁定等价；测试内 chdir 依赖调用时语义。 */
export function toPosix(file: string): string {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

export function isTestPath(rel: string): boolean {
  return rel.includes("/test/") || rel.includes("/__tests__/") || rel.includes("/e2e/") || /\.(test|spec)\.tsx?$/.test(rel);
}

/** 收集待扫文件：--changed 用 git 改动集（含未跟踪文件），否则用 paths，缺省 packages/core/src；测试路径默认剔除。 */
export function collectFiles(flags: Pick<CliFlags, "changed" | "includeTests" | "paths">): string[] {
  const roots = flags.changed ? changedFiles() : flags.paths.length > 0 ? flags.paths : ["packages/core/src"];
  const files: string[] = [];
  for (const root of roots) {
    const absolute = path.resolve(process.cwd(), root);
    if (fs.existsSync(absolute)) walk(absolute, files);
  }
  const unique = [...new Set(files)].filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)) && (flags.includeTests || !isTestPath(toPosix(file))));
  return unique.sort();
}

export function parseSource(file: string): ts.SourceFile {
  const text = fs.readFileSync(file, "utf8");
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** 1 起始行号；传数字按文件内绝对位置算。 */
export function lineOf(sourceFile: ts.SourceFile, node: ts.Node | number): number {
  return sourceFile.getLineAndCharacterOfPosition(typeof node === "number" ? node : node.getStart(sourceFile)).line + 1;
}

/** 等宽对齐表格：两空格列距，与旧脚本输出风格一致。 */
export function formatTable(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => String(row[index]).length)));
  const lines = [headers.map((value, index) => value.padEnd(widths[index])).join("  "), widths.map((width) => "-".repeat(width)).join("  ")];
  for (const row of rows) lines.push(row.map((value, index) => String(value).padEnd(widths[index])).join("  "));
  return lines.join("\n");
}
