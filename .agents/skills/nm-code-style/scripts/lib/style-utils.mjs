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
  return { changed: argv.includes("--changed"), includeTests: argv.includes("--include-tests"), all: argv.includes("--all"), strict: argv.includes("--strict"), verbose: argv.includes("--verbose"), json: argv.includes("--json"), paths: argv.filter((arg) => !arg.startsWith("--")) };
}

function gitLines(command) {
  try {
    // 大改动（千文件级）的 diff 输出可超 execSync 默认 1MB maxBuffer，超限抛错会让 --changed
    // 的行级过滤静默失效（所有行都算新增行）——这里放大到 64MB 并保持失败时返回空。
    return execSync(command, { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 }).trim().split(/\r?\n/).filter(Boolean);
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

/**
 * `--changed` 时只报新增行；未跟踪文件视为整文件新增。
 * hunk 内「删了又加」的行（行尾变化、重排后内容不变）不算新增——只报真正新增内容的行，
 * 否则触碰大文件时既有拆行会被当成新增债报出。跨 hunk 移动不在此配对（bare-exports 段另有 HEAD 兜底）。
 */
export function addedLineFilter(changed) {
  if (!changed) return () => true;
  const addedLines = new Map();
  let current = null;
  let plusLine = 0;
  let removedInHunk = new Map();
  const consumeRemoved = (text) => {
    const count = removedInHunk.get(text) ?? 0;
    if (count > 0) removedInHunk.set(text, count - 1);
  };
  for (const raw of gitLines("git diff HEAD -U0")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("diff --git ")) {
      current = null;
    } else if (line.startsWith("+++ b/")) {
      current = line.slice(6);
    } else if (current != null && line.startsWith("@@")) {
      const match = /\+(\d+)(?:,(\d+))?/.exec(line);
      plusLine = match == null ? 0 : Number(match[1]);
      removedInHunk = new Map();
    } else if (current != null && line.startsWith("-") && !line.startsWith("---")) {
      const text = line.slice(1);
      removedInHunk.set(text, (removedInHunk.get(text) ?? 0) + 1);
    } else if (current != null && line.startsWith("+") && !line.startsWith("+++")) {
      const text = line.slice(1);
      const removedCount = removedInHunk.get(text) ?? 0;
      if (removedCount > 0) {
        consumeRemoved(text);
      } else {
        const set = addedLines.get(current) ?? new Set();
        set.add(plusLine);
        addedLines.set(current, set);
      }
      plusLine += 1;
    }
  }
  return (file, line) => {
    const set = addedLines.get(toPosix(file));
    return set == null || set.has(line);
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
