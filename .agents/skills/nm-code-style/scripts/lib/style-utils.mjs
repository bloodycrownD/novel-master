/**
 * nm-code-style 检测脚本共用工具。
 * 只做解析、遍历、目标文件收集与表格输出；不修改任何文件。
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const repoRoot = process.cwd();
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".worktree", "coverage", "build"]);

export function walk(entry, out = []) {
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

export function toPosix(file) {
  return path.relative(repoRoot, file).replace(/\\/g, "/");
}

export function isTestPath(rel) {
  return rel.includes("/test/") || rel.includes("/__tests__/") || rel.includes("/e2e/") || /\.(test|spec)\.tsx?$/.test(rel);
}

export function parseFlags(argv) {
  return { changed: argv.includes("--changed"), includeTests: argv.includes("--include-tests"), json: argv.includes("--json"), paths: argv.filter((arg) => !arg.startsWith("--")) };
}

function gitLines(command) {
  try {
    return execSync(command, { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function changedFiles() {
  return [...gitLines("git diff HEAD --name-only --diff-filter=ACM"), ...gitLines("git ls-files --others --exclude-standard")];
}

export function collectFiles({ changed, includeTests, paths }) {
  const roots = changed ? changedFiles() : paths.length > 0 ? paths : ["packages/core/src"];
  const files = [];
  for (const root of roots) {
    const absolute = path.resolve(repoRoot, root);
    if (fs.existsSync(absolute)) walk(absolute, files);
  }
  const unique = [...new Set(files)].filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)) && (includeTests || !isTestPath(toPosix(file))));
  return unique.sort();
}

/** `--changed` 时只报新增行；未跟踪文件视为整文件新增。 */
export function addedLineFilter(changed) {
  if (!changed) return () => true;
  const ranges = new Map();
  let current = null;
  for (const line of gitLines("git diff HEAD -U0")) {
    if (line.startsWith("diff --git ")) {
      current = null;
    } else if (line.startsWith("+++ b/")) {
      current = line.slice(6);
    } else if (current != null && line.startsWith("@@")) {
      const match = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (match == null) continue;
      const start = Number(match[1]);
      const count = match[2] == null ? 1 : Number(match[2]);
      const list = ranges.get(current) ?? [];
      list.push([start, start + count - 1]);
      ranges.set(current, list);
    }
  }
  return (file, line) => {
    const list = ranges.get(toPosix(file));
    return list == null || list.some(([start, end]) => line >= start && line <= end);
  };
}

export function parseSource(file) {
  const text = fs.readFileSync(file, "utf8");
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

export function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(typeof node === "number" ? node : node.getStart(sourceFile)).line + 1;
}

export function forEachNode(node, callback) {
  callback(node);
  for (const child of node.getChildren()) forEachNode(child, callback);
}

export function formatTable(headers, rows) {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => String(row[index]).length)));
  const lines = [headers.map((value, index) => value.padEnd(widths[index])).join("  "), widths.map((width) => "-".repeat(width)).join("  ")];
  for (const row of rows) lines.push(row.map((value, index) => String(value).padEnd(widths[index])).join("  "));
  return lines.join("\n");
}
